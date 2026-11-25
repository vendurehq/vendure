/*
 * E2E tests for plugin packages that declare `defineCommand` commands through
 * `vendure.commandManifest` and `vendure.commandDefinitions`.
 *
 * They spawn the built CLI (`dist/cli.js`) against a temporary project, so they exercise
 * discovery, the manifest merge and the host the same way a real installation does.
 */
import { buildCommandManifest, readManifestFile } from '@vendure/common/lib/command/manifest';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createTestProject, installCliPluginFixture, readMarker } from './cli-test-utils.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'cli-plugins');
const EXAMPLE = '@vendure-e2e/defined-commands-cli-plugin';
const CLASHING = '@vendure-e2e/clashing-defined-commands-cli-plugin';

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

    it.each(['defined-commands-cli-plugin', 'clashing-defined-commands-cli-plugin'])(
        'ships a %s manifest built from its declarations, without @vendure/cli',
        async fixture => {
            const dir = join(FIXTURES_DIR, fixture);
            const { commands } = await import(join(dir, 'commands.js'));
            const shipped = readManifestFile(join(dir, 'vendure-commands.json'));
            expect(await buildCommandManifest(shipped.package, shipped.version, commands)).toEqual(shipped);
        },
    );

    describe('an enabled plugin', () => {
        it('adds its commands to the merged set in vendure commands --json', async () => {
            const envelope = await listCommands(projectWith(['defined-commands-cli-plugin']));

            expect(envelope.status).toBe('ok');
            const fromPlugin = envelope.output.commands.filter((c: any) => c.source === EXAMPLE);
            expect(fromPlugin.map((c: any) => c.path.join(' '))).toEqual(['example greet', 'example reset']);
            expect(fromPlugin[1]).toMatchObject({ behavior: 'destructive', hasPlan: true });
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

    describe('a plugin that is installed but not enabled', () => {
        it('stays out of vendure commands --json, and its commands do not run', async () => {
            const p = projectWith(['defined-commands-cli-plugin', { enable: false }]);

            const envelope = await listCommands(p);
            expect(envelope.output.commands.filter((c: any) => c.source === EXAMPLE)).toEqual([]);

            const run = await p.runCliCommand(['example', 'greet', 'Ada', '--json'], { expectError: true });
            expect(run.exitCode).not.toBe(0);
            expect(run.stdout).not.toContain('Hello');
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
            expect(envelope.notices[0]).toMatchObject({ level: 'warning' });
            const sources = new Set(envelope.output.commands.map((c: any) => c.source));
            expect(sources).toEqual(new Set(['@vendure/cli', EXAMPLE]));

            // The startup report names the code, and how to disable the package.
            const help = await p.runCliCommand(['--help']);
            expect(help.stderr).toContain('[plugin.command-clash]');
            expect(help.stderr).toContain(`vendure plugins remove ${CLASHING}`);

            const clashing = await p.runCliCommand(['clashing', 'hello', '--json'], { expectError: true });
            expect(clashing.exitCode).not.toBe(0);
        });
    });
});
