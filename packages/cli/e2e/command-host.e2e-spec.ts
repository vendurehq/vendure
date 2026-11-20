import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CliTestProject, createTestProject } from './cli-test-utils.js';

const cliPath = join(import.meta.dirname, '..', 'dist', 'cli.js');

const PLUGIN = `
import { VendurePlugin, PluginCommonModule } from '@vendure/core';

@VendurePlugin({ imports: [PluginCommonModule] })
export class AlphaPlugin {}
`;

/**
 * Copies the migrate fixture, which has a SQLite database, into its own directory. The copy sits
 * inside the repository, so the project resolves `@vendure/core` from the repository's
 * `node_modules`, and it does not share a database with the other migrate specs.
 */
function copyMigrateFixture(): string {
    const dir = join(import.meta.dirname, 'fixtures', `.tmp-revert-${randomBytes(6).toString('hex')}`);
    const source = join(import.meta.dirname, 'fixtures', 'test-project');
    // The migrate spec writes its database and migrations into the fixture while it runs.
    const shared = [join(source, 'test.db'), join(source, 'migrations')];
    cpSync(source, dir, { recursive: true, filter: path => !shared.some(s => path.startsWith(s)) });
    return dir;
}

function runCli(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', reject);
        child.on('close', code => resolve({ stdout, stderr, exitCode: code ?? -1 }));
    });
}

/** Generates a migration in the project and applies it, so there is one to revert. */
async function applyOneMigration(cwd: string): Promise<void> {
    for (const args of [
        ['migrate', '--generate', 'First'],
        ['migrate', '--run'],
    ]) {
        const result = await runCli(cwd, args);
        if (result.exitCode !== 0) {
            throw new Error(`vendure ${args.join(' ')} failed: ${result.stderr}`);
        }
    }
}

/** Runs `vendure mcp` and talks to it over stdio, one JSON-RPC message per line. */
function startMcp(cwd: string) {
    const child = spawn(process.execPath, [cliPath, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const messages: any[] = [];
    const waiting: Array<{ match: (m: any) => boolean; resolve: (m: any) => void }> = [];
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines.filter(Boolean)) {
            const message = JSON.parse(line);
            messages.push(message);
            const index = waiting.findIndex(w => w.match(message));
            if (index >= 0) {
                waiting.splice(index, 1)[0].resolve(message);
            }
        }
    });
    let nextId = 1;
    const request = (method: string, params?: object) => {
        const id = nextId++;
        const reply = new Promise<any>(resolve => {
            const existing = messages.find(m => m.id === id);
            if (existing) {
                resolve(existing);
            } else {
                waiting.push({ match: m => m.id === id, resolve });
            }
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        return reply;
    };
    return {
        messages,
        request,
        callTool: (name: string, args: object) => request('tools/call', { name, arguments: args }),
        close: () =>
            new Promise<void>(resolve => {
                child.on('close', () => resolve());
                child.stdin.end();
            }),
    };
}

describe('Command host E2E', () => {
    let testProject: CliTestProject;
    /** A copy of the migrate fixture, made by a test that needs a project with a database. */
    let fixtureDir: string | undefined;

    afterEach(() => {
        testProject?.cleanup();
        if (fixtureDir) {
            rmSync(fixtureDir, { recursive: true, force: true });
            fixtureDir = undefined;
        }
    });

    describe('vendure commands --json', () => {
        it('prints the merged manifest in one envelope', async () => {
            testProject = createTestProject('commands-json');

            const result = await testProject.runCliCommand(['commands', '--json']);

            const envelope = JSON.parse(result.stdout);
            expect(envelope.status).toBe('ok');
            const byPath = Object.fromEntries(
                envelope.output.commands.map((c: any) => [c.path.join(' '), c]),
            );
            expect(Object.keys(byPath)).toEqual(
                expect.arrayContaining(['doctor', 'add codegen', 'migrate revert', 'commands']),
            );
            expect(byPath['migrate revert'].behavior).toBe('destructive');
            expect(byPath['migrate revert'].consents).toHaveProperty('revertMigration');
            expect(byPath['migrate revert'].input.properties).toHaveProperty('revertMigration');
            expect(byPath.doctor.input.properties).toHaveProperty('check');
            expect(byPath.commands.expose).toEqual({ mcp: false });
            expect(byPath.doctor.source).toBe('@vendure/cli');
        });
    });

    describe('incomplete results', () => {
        it('returns the incomplete exit code, with the missing field and its choices', async () => {
            testProject = createTestProject('add-codegen-incomplete');
            testProject.writeFile(
                'tsconfig.json',
                JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
            );
            testProject.writeFile('src/alpha.plugin.ts', PLUGIN);

            const result = await testProject.runCliCommand(['add', 'codegen', '--json'], {
                expectError: true,
            });

            expect(result.exitCode).toBe(3);
            const envelope = JSON.parse(result.stdout);
            expect(envelope.status).toBe('incomplete');
            expect(envelope.needs).toEqual([
                expect.objectContaining({ kind: 'input', field: 'plugin', choices: ['AlphaPlugin'] }),
            ]);
        });

        it('prints the needs as text, and does not prompt, when there is no TTY and no --json', async () => {
            testProject = createTestProject('add-codegen-incomplete-text');
            testProject.writeFile(
                'tsconfig.json',
                JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
            );
            testProject.writeFile('src/alpha.plugin.ts', PLUGIN);

            const result = await testProject.runCliCommand(['add', 'codegen'], { expectError: true });

            expect(result.exitCode).toBe(3);
            expect(result.stderr).toContain('--plugin');
            expect(result.stderr).toContain('AlphaPlugin');
        });

        it('keeps stdout to the envelope when project code writes to it', { timeout: 60_000 }, async () => {
            fixtureDir = copyMigrateFixture();
            const configFile = join(fixtureDir, 'src', 'vendure-config.ts');
            writeFileSync(
                configFile,
                `${readFileSync(configFile, 'utf-8')}\nconsole.log('noise from the config');\nprocess.stdout.write('more noise\\n');\n`,
            );

            const result = await runCli(fixtureDir, ['doctor', '--check', 'config', '--json']);

            // The config ran and wrote to stdout, and that went to stderr.
            expect(result.stderr).toContain('noise from the config');
            expect(result.stderr).toContain('more noise');
            const envelope = JSON.parse(result.stdout);
            expect(envelope.output.checks[0]).toMatchObject({ name: 'Config', status: 'pass' });
        });
    });

    // Each CLI run here loads the project's config, which takes several seconds on a busy runner.
    describe('consents', { timeout: 180_000 }, () => {
        // A consent is given for one preview. Its digest names the migration and the database,
        // so a digest that is wrong, or that answers an earlier preview, is asked for again.
        it('reverts a migration only with the digest of the preview the caller saw', async () => {
            fixtureDir = copyMigrateFixture();
            await applyOneMigration(fixtureDir);

            const first = await runCli(fixtureDir, ['migrate', 'revert', '--json']);
            expect(first.exitCode).toBe(3);
            const asked = JSON.parse(first.stdout);
            expect(asked.status).toBe('incomplete');
            expect(asked.needs).toHaveLength(1);
            const need = asked.needs[0];
            expect(need).toMatchObject({ kind: 'consent', consent: 'revertMigration' });
            expect(need.preview.lastAppliedMigration).toMatch(/^First/);
            expect(need.preview.database.type).toBe('better-sqlite3');

            const wrong = await runCli(fixtureDir, [
                'migrate',
                'revert',
                '--json',
                '--revert-migration',
                'not-the-digest',
            ]);
            expect(wrong.exitCode).toBe(3);
            expect(JSON.parse(wrong.stdout).needs[0].digest).toBe(need.digest);

            const applied = await runCli(fixtureDir, [
                'migrate',
                'revert',
                '--json',
                '--revert-migration',
                need.digest,
            ]);
            expect(applied.exitCode).toBe(0);
            expect(JSON.parse(applied.stdout)).toMatchObject({
                status: 'ok',
                output: { reverted: true, migration: need.preview.lastAppliedMigration },
            });
        });

        it('reverts nothing, and asks for no consent, when no migration is applied', async () => {
            fixtureDir = copyMigrateFixture();

            const result = await runCli(fixtureDir, ['migrate', 'revert', '--json']);

            expect(result.exitCode).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({
                status: 'ok',
                output: { reverted: false, migration: null },
            });
        });

        it('takes the consent digest as tool input over MCP', async () => {
            fixtureDir = copyMigrateFixture();
            await applyOneMigration(fixtureDir);
            const mcp = startMcp(fixtureDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const asked = await mcp.callTool('execute_destructive', {
                    tool: 'migrate_revert',
                    input: {},
                });
                expect(asked.result.isError).toBe(false);
                const need = asked.result.structuredContent.needs[0];
                expect(need.kind).toBe('consent');

                const applied = await mcp.callTool('execute_destructive', {
                    tool: 'migrate_revert',
                    input: { revertMigration: need.digest },
                });
                expect(applied.result.isError).toBe(false);
                expect(applied.result.structuredContent).toMatchObject({
                    status: 'ok',
                    output: { reverted: true },
                });
            } finally {
                await mcp.close();
            }
        });
    });

    describe('vendure mcp', () => {
        it('lists the discovery tools, finds a command and runs it in a child process', async () => {
            testProject = createTestProject('mcp-discovery');
            const mcp = startMcp(testProject.projectDir);
            try {
                const init = await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                expect(init.result.serverInfo.name).toBe('vendure-developer-mcp');

                const list = await mcp.request('tools/list');
                expect(list.result.tools.map((t: any) => t.name)).toEqual([
                    'search_tools',
                    'execute_readonly',
                    'execute_mutating',
                    'execute_destructive',
                ]);

                const search = await mcp.callTool('search_tools', { query: 'revert migration' });
                expect(search.result.structuredContent.tools[0].name).toBe('migrate_revert');
                expect(search.result.structuredContent.tools[0].behavior).toBe('destructive');

                const wrong = await mcp.callTool('execute_readonly', { tool: 'migrate_revert' });
                expect(wrong.result.isError).toBe(true);

                const doctor = await mcp.callTool('execute_readonly', {
                    tool: 'doctor',
                    input: { check: ['project'] },
                });
                expect(doctor.result.isError).toBe(false);
                expect(doctor.result.structuredContent.status).toBe('ok');
                expect(doctor.result.structuredContent.output.checks[0].name).toBe('Project');
            } finally {
                await mcp.close();
            }
        });

        it('returns a failed doctor run as an error result with the envelope', async () => {
            testProject = createTestProject('mcp-failed');
            testProject.writeFile(
                'package.json',
                JSON.stringify({ name: 'not-vendure', version: '1.0.0', dependencies: { express: '4.0.0' } }),
            );
            const mcp = startMcp(testProject.projectDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const doctor = await mcp.callTool('execute_readonly', {
                    tool: 'doctor',
                    input: { check: ['project'] },
                });
                expect(doctor.result.isError).toBe(true);
                expect(doctor.result.structuredContent.status).toBe('failed');
            } finally {
                await mcp.close();
            }
        });

        it('returns incomplete as a normal result', async () => {
            testProject = createTestProject('mcp-incomplete');
            testProject.writeFile(
                'tsconfig.json',
                JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
            );
            testProject.writeFile('src/alpha.plugin.ts', PLUGIN);
            const mcp = startMcp(testProject.projectDir);
            try {
                await mcp.request('initialize', { protocolVersion: '2025-06-18' });
                const result = await mcp.callTool('execute_mutating', { tool: 'add_codegen', input: {} });
                expect(result.result.isError).toBe(false);
                expect(result.result.structuredContent.status).toBe('incomplete');
                expect(result.result.structuredContent.needs[0].choices).toEqual(['AlphaPlugin']);
            } finally {
                await mcp.close();
            }
        });

        it('lists each command as a tool in direct mode, without service or CLI-only commands', async () => {
            testProject = createTestProject('mcp-direct');
            const child = spawn(process.execPath, [cliPath, 'mcp', '--mode', 'direct'], {
                cwd: testProject.projectDir,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const output = await new Promise<string>(resolve => {
                let text = '';
                child.stdout.on('data', (chunk: Buffer) => {
                    text += chunk.toString();
                    if (text.includes('"id":2')) {
                        resolve(text);
                    }
                });
                child.stdin.write(
                    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n` +
                        `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`,
                );
            });
            child.stdin.end();
            const tools = JSON.parse(output.split('\n').filter(Boolean)[1]).result.tools;
            expect(tools.map((t: any) => t.name)).toEqual(['add_codegen', 'doctor', 'migrate_revert']);
        });
    });
});
