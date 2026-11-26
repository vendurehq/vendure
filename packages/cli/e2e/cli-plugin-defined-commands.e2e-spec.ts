/*
 * E2E tests for plugin packages that declare `defineCommand` commands through
 * `vendure.commandManifest` and `vendure.commandDefinitions`.
 *
 * They spawn the built CLI (`dist/cli.js`) against a temporary project, so they exercise
 * discovery, the manifest merge and the host the same way a real installation does.
 */
import { buildCommandManifest, readManifestFile } from '@vendure/common/lib/command/manifest';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    CliTestProject,
    createTestProject,
    installCliPluginFixture,
    readMarker,
    startMcpServer,
} from './cli-test-utils.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'cli-plugins');
const EXAMPLE = '@vendure-e2e/defined-commands-cli-plugin';
const CLASHING = '@vendure-e2e/clashing-defined-commands-cli-plugin';
const PARENT = '@vendure-e2e/parent-commands-cli-plugin';
const EXTENSION = '@vendure-e2e/extension-cli-plugin';

function envelopeOf(stdout: string) {
    const lines = stdout.split('\n').filter(line => line.trim());
    expect(lines).toHaveLength(1);
    return JSON.parse(lines[0]);
}

async function listCommands(project: CliTestProject) {
    const result = await project.runCliCommand(['commands', '--json']);
    return envelopeOf(result.stdout);
}

describe('CLI plugin defineCommand commands', { timeout: 60_000 }, () => {
    let project: CliTestProject | undefined;

    afterEach(() => {
        project?.cleanup();
        project = undefined;
    });

    function projectWith(...fixtures: Array<[string, { enable?: boolean }?]>): CliTestProject {
        project = createTestProject('cli-plugin-defined-commands');
        for (const [fixture, options] of fixtures) {
            installCliPluginFixture(project, fixture, options);
        }
        return project;
    }

    it.each([
        'defined-commands-cli-plugin',
        'clashing-defined-commands-cli-plugin',
        'parent-commands-cli-plugin',
        'extension-cli-plugin',
    ])('ships a %s manifest built from its declarations, without @vendure/cli', async fixture => {
        const dir = join(FIXTURES_DIR, fixture);
        const { commands, groups, extensions } = await import(join(dir, 'commands.js'));
        const shipped = readManifestFile(join(dir, 'vendure-commands.json'));
        expect(
            await buildCommandManifest(shipped.package, shipped.version, commands, { groups, extensions }),
        ).toEqual(shipped);
    });

    // A package may extend a command another package declares, here the CLI's own `explain` and `dev`.
    describe('a plugin that extends commands of the CLI', () => {
        it('adds its flag to help, its field to vendure commands --json and to the MCP tool', async () => {
            const p = projectWith(['extension-cli-plugin']);

            const help = await p.runCliCommand(['explain', '--help']);
            expect(help.stdout).toContain('--shout');
            expect((await p.runCliCommand(['dev', '--help'])).stdout).toContain('--cloud-project');

            const envelope = await listCommands(p);
            expect(envelope.output.refused).toBeUndefined();
            const explain = envelope.output.commands.find((c: any) => c.path.join(' ') === 'explain');
            expect(Object.keys(explain.input.properties)).toEqual(
                expect.arrayContaining(['requestId', 'shout']),
            );
            expect(explain.extendedBy).toEqual([{ package: EXTENSION, fields: ['shout'] }]);
            const dev = envelope.output.commands.find((c: any) => c.path.join(' ') === 'dev');
            expect(dev.extendedBy).toEqual([{ package: EXTENSION, fields: ['cloudProject'] }]);

            const mcp = startMcpServer(p.projectDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const search = await mcp.callTool('search_tools', { query: 'explain' });
                const tool = search.result.structuredContent.tools.find((t: any) => t.name === 'explain');
                expect(Object.keys(tool.inputSchema.properties)).toContain('shout');
            } finally {
                await mcp.close();
            }
        });

        it('runs the extension around the command: it changes the input and adds to the output', async () => {
            const result = await projectWith(['extension-cli-plugin']).runCliCommand([
                'explain',
                'abc-123',
                '--shout',
                '--json',
            ]);

            expect(envelopeOf(result.stdout)).toMatchObject({
                status: 'ok',
                output: { requestId: 'ABC-123', extendedBy: EXTENSION },
            });
        });
    });

    // A plugin may declare a command and commands under it, such as `acme deploy` and
    // `acme deploy plan`.
    describe('a plugin with a command that has commands under it', () => {
        it('lists both, and runs each under --json', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);

            const envelope = await listCommands(p);
            expect(envelope.output.refused).toBeUndefined();
            expect(
                envelope.output.commands
                    .filter((c: any) => c.source === PARENT)
                    .map((c: any) => c.path.join(' '))
                    .sort(),
            ).toEqual(['acme deploy', 'acme deploy plan']);

            const deploy = await p.runCliCommand(['acme', 'deploy', '--environment', 'prod', '--json']);
            expect(envelopeOf(deploy.stdout).output).toEqual({ ran: 'deploy', environment: 'prod' });

            const plan = await p.runCliCommand(['acme', 'deploy', 'plan', '--environment', 'prod', '--json']);
            expect(envelopeOf(plan.stdout).output).toEqual({ ran: 'plan', environment: 'prod' });
        });

        it('takes an option of the command above before or after the name of the command under it', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);

            const result = await p.runCliCommand([
                'acme',
                'deploy',
                '--environment',
                'prod',
                'plan',
                '--json',
            ]);
            expect(envelopeOf(result.stdout).output).toEqual({ ran: 'plan', environment: 'prod' });
        });

        it('refuses an option of the command above that the command that runs does not take', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);

            for (const args of [
                ['acme', 'deploy', 'plan', '--force', '--json'],
                ['acme', 'deploy', '--force', 'plan', '--json'],
            ]) {
                const result = await p.runCliCommand(args, { expectError: true });
                expect(envelopeOf(result.stdout).error).toMatchObject({
                    code: 'cli.usage',
                    message: '--force is not an option of "acme deploy plan"',
                });
            }
        });

        // `acme deploy` takes over the group made for it, with the error handling of a command, so an
        // option no command has is Commander's unknown option, not a line with the options moved.
        it('reports an option that no command has as unknown, not as one before the subcommand', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);

            const result = await p.runCliCommand(['acme', 'deploy', '--nope', 'plan', '--json'], {
                expectError: true,
            });
            expect(envelopeOf(result.stdout).error).toMatchObject({
                code: 'cli.usage',
                message: expect.stringContaining("unknown option '--nope'"),
            });
        });

        it('reports a name that is not a command under it as a coded line without --json', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);

            const result = await p.runCliCommand(['acme', 'deploy', 'plna'], { expectError: true });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('[cli.usage] "plna" is not a command of "acme deploy"');
        });

        it('reports a name that is not a command under it', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);

            const result = await p.runCliCommand(['acme', 'deploy', 'plna', '--json'], { expectError: true });
            expect(envelopeOf(result.stdout).error).toMatchObject({
                code: 'cli.usage',
                message: '"plna" is not a command of "acme deploy"',
            });
        });

        it('offers both as Developer MCP tools', async () => {
            const p = projectWith(['parent-commands-cli-plugin']);
            const mcp = startMcpServer(p.projectDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const search = await mcp.callTool('search_tools', { query: 'deploy' });
                expect(search.result.structuredContent.tools.map((t: any) => t.name)).toEqual(
                    expect.arrayContaining(['acme_deploy', 'acme_deploy_plan']),
                );
                const plan = await mcp.callTool('execute_readonly', {
                    tool: 'acme_deploy_plan',
                    input: { environment: 'prod' },
                });
                expect(plan.result.structuredContent).toMatchObject({
                    status: 'ok',
                    output: { ran: 'plan', environment: 'prod' },
                });
            } finally {
                await mcp.close();
            }
        });
    });

    describe('an enabled plugin', () => {
        it('adds its commands to the merged set in vendure commands --json', async () => {
            const envelope = await listCommands(projectWith(['defined-commands-cli-plugin']));

            expect(envelope.status).toBe('ok');
            const fromPlugin = envelope.output.commands.filter((c: any) => c.source === EXAMPLE);
            expect(fromPlugin.map((c: any) => c.path.join(' '))).toEqual([
                'example greet',
                'example deploy',
                'example reset',
            ]);
            expect(fromPlugin[2]).toMatchObject({ behavior: 'destructive', hasPlan: true });
            // The CLI's own commands are still there.
            expect(envelope.output.commands.find((c: any) => c.path.join(' ') === 'doctor').source).toBe(
                '@vendure/cli',
            );
            expect(envelope.output.refused).toBeUndefined();
        });

        it('lists the commands of its manifest in vendure plugins --json', async () => {
            const result = await projectWith(['defined-commands-cli-plugin']).runCliCommand([
                'plugins',
                '--json',
            ]);

            const entry = JSON.parse(result.stdout).plugins.find((p: any) => p.packageName === EXAMPLE);
            expect(entry).toMatchObject({ status: 'enabled', manifestCommands: ['example'] });
        });

        it('runs a command under --json, with one envelope on stdout', async () => {
            const result = await projectWith(['defined-commands-cli-plugin']).runCliCommand([
                'example',
                'greet',
                'Ada',
                '-s',
                '--json',
            ]);

            expect(envelopeOf(result.stdout)).toEqual({
                schemaVersion: 1,
                status: 'ok',
                output: { message: 'HELLO, ADA!' },
                notices: [{ level: 'info', message: 'Greeting Ada' }],
            });
        });

        it("hands run() the shared input of the package's command group", async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            const listed = await listCommands(p);
            const greet = listed.output.commands.find((c: any) => c.path.join(' ') === 'example greet');
            expect(Object.keys(greet.input.properties)).toContain('audience');

            const result = await p.runCliCommand(['example', 'greet', 'Ada', '-a', 'team', '--json']);
            expect(envelopeOf(result.stdout).output).toEqual({ message: 'Hello, Ada and team!' });

            const viaInput = await p.runCliCommand([
                'example',
                'greet',
                '--input',
                '{"name":"Grace","audience":"all"}',
                '--json',
            ]);
            expect(envelopeOf(viaInput.stdout).output).toEqual({ message: 'Hello, Grace and all!' });
        });

        it('takes the whole input through --input, and names a missing field as an input need', async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            const ok = await p.runCliCommand(['example', 'greet', '--input', '{"name":"Grace"}', '--json']);
            expect(envelopeOf(ok.stdout).output).toEqual({ message: 'Hello, Grace!' });

            const missing = await p.runCliCommand(['example', 'greet', '--json'], { expectError: true });
            expect(missing.exitCode).toBe(3);
            expect(envelopeOf(missing.stdout)).toMatchObject({
                status: 'incomplete',
                needs: [{ kind: 'input', field: 'name' }],
            });
        });

        it('asks for a named consent with the digest of its preview before a destructive run', async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            p.writeFile('example-data.json', '{}');

            const first = await p.runCliCommand(['example', 'reset', '--json'], { expectError: true });
            const incomplete = envelopeOf(first.stdout);
            expect(incomplete.status).toBe('incomplete');
            const need = incomplete.needs[0];
            expect(need).toMatchObject({ kind: 'consent', consent: 'resetData' });
            expect(p.fileExists('example-data.json')).toBe(true);

            const second = await p.runCliCommand(['example', 'reset', '--reset-data', need.digest, '--json']);
            expect(envelopeOf(second.stdout)).toMatchObject({
                status: 'ok',
                output: { deleted: expect.stringContaining('example-data.json') },
            });
            expect(p.fileExists('example-data.json')).toBe(false);

            // The plugin's coded error reaches the envelope like a core command's.
            const third = await p.runCliCommand(['example', 'reset', '--reset-data', need.digest, '--json'], {
                expectError: true,
            });
            expect(envelopeOf(third.stdout).error).toMatchObject({ code: 'example.nothing-to-reset' });
        });

        it('asks for a consent that run() finds, and runs with its digest', async () => {
            const p = projectWith(['defined-commands-cli-plugin']);

            const first = await p.runCliCommand(
                ['example', 'deploy', '--environment', 'production', '--json'],
                {
                    expectError: true,
                },
            );
            const need = envelopeOf(first.stdout).needs[0];
            expect(need).toMatchObject({
                kind: 'consent',
                consent: 'deployToProduction',
                preview: { environment: 'production' },
            });

            const second = await p.runCliCommand([
                'example',
                'deploy',
                '--environment',
                'production',
                '--deploy-to-production',
                need.digest,
                '--json',
            ]);
            expect(envelopeOf(second.stdout)).toMatchObject({
                status: 'ok',
                output: { deployed: 'production' },
            });
        });

        it('offers its commands as Developer MCP tools, and runs them in a child process', async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            const mcp = startMcpServer(p.projectDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const search = await mcp.callTool('search_tools', { query: 'greet' });
                expect(search.result.structuredContent.tools[0]).toMatchObject({
                    name: 'example_greet',
                    behavior: 'readonly',
                });

                const greet = await mcp.callTool('execute_readonly', {
                    tool: 'example_greet',
                    input: { name: 'Ada' },
                });
                expect(greet.result.isError).toBe(false);
                expect(greet.result.structuredContent).toMatchObject({
                    status: 'ok',
                    output: { message: 'Hello, Ada!' },
                });

                // A destructive plugin command needs the destructive executor and a consent.
                const reset = await mcp.callTool('execute_destructive', { tool: 'example_reset', input: {} });
                expect(reset.result.structuredContent).toMatchObject({
                    status: 'incomplete',
                    needs: [{ kind: 'consent', consent: 'resetData' }],
                });
            } finally {
                await mcp.close();
            }
        });

        it('lists its commands under the package in vendure --help', async () => {
            const result = await projectWith(['defined-commands-cli-plugin']).runCliCommand(['--help']);
            expect(result.stdout).toContain(`Commands from ${EXAMPLE}:`);
        });

        it('keeps the commands of a 3.8 cliPlugin working beside it', async () => {
            const p = projectWith(['cloud-cli-plugin'], ['defined-commands-cli-plugin']);

            const legacy = await p.runCliCommand(['project', 'list']);
            expect(readMarker(legacy.stdout, 'CLOUD_RESULT').command).toEqual(['project', 'list']);
            const defined = await p.runCliCommand(['example', 'greet', 'Ada', '--json']);
            expect(envelopeOf(defined.stdout).output).toEqual({ message: 'Hello, Ada!' });
        });
    });

    describe('a CLI plugin that is slow to load', () => {
        it("lets vendure mcp start with the CLI's own tools, and say why", { timeout: 60_000 }, async () => {
            const p = projectWith(['defined-commands-cli-plugin'], ['slow-cli-plugin']);
            const mcp = startMcpServer(p.projectDir);
            try {
                const started = Date.now();
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                // The listing gives up after 15 seconds; the plugin takes 20.
                expect(Date.now() - started).toBeLessThan(19_000);
                const search = await mcp.callTool('search_tools', { query: 'doctor' });
                expect(search.result.structuredContent.tools.map((t: any) => t.name)).toContain('doctor');
                expect(mcp.stderr()).toContain('[mcp.commands-listing-timed-out]');
            } finally {
                await mcp.close();
            }
        });
    });

    describe('a plugin that is installed but not enabled', () => {
        it('stays out of vendure commands --json, and its commands do not run', async () => {
            const p = projectWith(['defined-commands-cli-plugin', { enable: false }]);

            const envelope = await listCommands(p);
            expect(envelope.output.commands.filter((c: any) => c.source === EXAMPLE)).toEqual([]);

            const run = await p.runCliCommand(['example', 'greet', 'Ada', '--json'], { expectError: true });
            expect(run.exitCode).toBe(1);
            expect(run.stdout).toBe('');
            // The hint reads the command names from the manifest, without loading the package.
            expect(run.stderr).toContain('Unknown command "example"');
            expect(run.stderr).toContain(`vendure plugins add ${EXAMPLE}`);

            const mcp = startMcpServer(p.projectDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const search = await mcp.callTool('search_tools', { query: 'greet' });
                expect(search.result.structuredContent.tools.map((t: any) => t.name)).not.toContain(
                    'example_greet',
                );
            } finally {
                await mcp.close();
            }
        });
    });

    describe('a package that also declares a cliPlugin', () => {
        /** Gives the installed defineCommand fixture a cliPlugin with one command, `name`. */
        function addCliPlugin(p: CliTestProject, name: string): string {
            const dir = join('node_modules', ...EXAMPLE.split('/'));
            p.writeFile(
                join(dir, 'cli-plugin.cjs'),
                `module.exports = { id: '${EXAMPLE}', commands: [{ name: '${name}', description: 'Legacy', ` +
                    `action: async () => { console.log('LEGACY_RAN'); return 0; } }] };\n`,
            );
            const packageJson = JSON.parse(p.readFile(join(dir, 'package.json')));
            packageJson.vendure.cliPlugin = './cli-plugin.cjs';
            p.writeFile(join(dir, 'package.json'), JSON.stringify(packageJson));
            return dir;
        }

        it('loads both kinds of command', async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            addCliPlugin(p, 'legacy');

            expect((await p.runCliCommand(['legacy'])).stdout).toContain('LEGACY_RAN');
            const greet = await p.runCliCommand(['example', 'greet', 'Ada', '--json']);
            expect(envelopeOf(greet.stdout).output).toEqual({ message: 'Hello, Ada!' });
        });

        it.each([
            ['cannot be parsed', '{ not json', 'plugin.manifest-invalid'],
            ['is missing', undefined, 'plugin.unavailable'],
            [
                'has a malformed command',
                JSON.stringify({ manifestVersion: 1, package: EXAMPLE, version: '1.0.0', commands: [{}] }),
                'plugin.manifest-invalid',
            ],
        ])('leaves out only the defineCommand commands when the manifest %s', async (_, content, code) => {
            const p = projectWith(['defined-commands-cli-plugin']);
            const dir = addCliPlugin(p, 'legacy');
            const manifestFile = join(p.projectDir, dir, 'vendure-commands.json');
            if (content === undefined) {
                rmSync(manifestFile);
            } else {
                writeFileSync(manifestFile, content);
            }

            const envelope = await listCommands(p);
            expect(envelope.output.refused).toEqual([
                { package: EXAMPLE, error: expect.objectContaining({ code }) },
            ]);
            expect(envelope.output.commands.filter((c: any) => c.source === EXAMPLE)).toEqual([]);
            // `vendure plugins` agrees: the package works, without its defineCommand commands.
            const plugins = JSON.parse((await p.runCliCommand(['plugins', '--json'])).stdout).plugins;
            expect(plugins.find((entry: any) => entry.packageName === EXAMPLE)).toMatchObject({
                status: 'enabled',
                loadedCommands: ['legacy'],
                manifestReason: expect.any(String),
            });
            // The CLI's own commands are still there.
            expect(envelope.output.commands.some((c: any) => c.path.join(' ') === 'doctor')).toBe(true);

            const legacy = await p.runCliCommand(['legacy']);
            expect(legacy.stdout).toContain('LEGACY_RAN');
            expect(legacy.stderr).toContain(
                `Failed to load the defineCommand commands of CLI plugin "${EXAMPLE}"`,
            );
        });

        it('keeps its defineCommand commands when its cliPlugin entry is missing', async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            const dir = addCliPlugin(p, 'legacy');
            rmSync(join(p.projectDir, dir, 'cli-plugin.cjs'));

            const greet = await p.runCliCommand(['example', 'greet', 'Ada', '--json']);
            expect(envelopeOf(greet.stdout).output).toEqual({ message: 'Hello, Ada!' });
            expect(greet.stderr).toContain(`Failed to load CLI plugin "${EXAMPLE}"`);
            expect((await listCommands(p)).output.refused).toBeUndefined();
        });

        it("refuses a defineCommand command that its own cliPlugin's command takes", async () => {
            const p = projectWith(['defined-commands-cli-plugin']);
            addCliPlugin(p, 'example');

            const envelope = await listCommands(p);
            expect(envelope.output.refused).toEqual([
                {
                    package: EXAMPLE,
                    error: expect.objectContaining({
                        code: 'plugin.command-clash',
                        message: expect.stringContaining(`the command "example" of ${EXAMPLE}`),
                    }),
                },
            ]);
            expect((await p.runCliCommand(['example'])).stdout).toContain('LEGACY_RAN');
        });
    });

    describe('a plugin whose command clashes', () => {
        it('is refused whole with a coded error, and the other commands stay', async () => {
            const p = projectWith(['clashing-defined-commands-cli-plugin'], ['defined-commands-cli-plugin']);

            const envelope = await listCommands(p);
            expect(envelope.output.refused).toEqual([
                {
                    package: CLASHING,
                    error: expect.objectContaining({
                        code: 'plugin.command-clash',
                        message: expect.stringContaining('the command "doctor" of @vendure/cli'),
                    }),
                },
            ]);
            // Startup has written the refusal to stderr already, so it is not repeated as a notice.
            expect(envelope.notices).toEqual([]);

            // `vendure plugins` agrees, and names the clash.
            const plugins = JSON.parse((await p.runCliCommand(['plugins', '--json'])).stdout).plugins;
            expect(plugins.find((entry: any) => entry.packageName === CLASHING)).toMatchObject({
                status: 'enabled',
                manifestReason: expect.stringContaining('[plugin.command-clash]'),
            });
            const sources = new Set(envelope.output.commands.map((c: any) => c.source));
            expect(sources).toEqual(new Set(['@vendure/cli', EXAMPLE]));

            // The startup report names the code, and how to disable the package.
            const help = await p.runCliCommand(['--help']);
            expect(help.stderr).toContain('[plugin.command-clash]');
            expect(help.stderr).toContain(`vendure plugins remove ${CLASHING}`);

            const clashing = await p.runCliCommand(['clashing', 'hello', '--json'], { expectError: true });
            expect(clashing.exitCode).toBe(1);
            expect(clashing.stdout).toBe('');
            expect(clashing.stderr).toContain('Unknown command "clashing"');
        });
    });
});
