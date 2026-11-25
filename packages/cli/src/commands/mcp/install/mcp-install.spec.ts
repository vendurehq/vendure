import type { SpawnOptions, SpawnResult } from '@vendure/common/lib/command';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runCommandInHarness } from '../../../command-host/__tests__/command-harness.js';

import { mcpInstallDefinition } from './mcp-install.command.js';

const roots: string[] = [];

/** A git repository with the given files, committed. Returns its real path. */
function repo(files: Record<string, string>): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-install-')));
    roots.push(root);
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    return root;
}

const vendureProject = JSON.stringify({ dependencies: { '@vendure/core': '4.0.0' } });
const cli = (version: string) =>
    JSON.stringify({ name: '@vendure/cli', version, bin: { vendure: 'dist/cli.js' } });

/** A Vendure project at the root of its repository, with its own @vendure/cli. */
const singleProject = () =>
    repo({
        'package.json': vendureProject,
        'node_modules/@vendure/cli/package.json': cli('4.0.0'),
        'src/plugins/reviews/reviews.plugin.ts': '',
    });

type Claude = (args: string[]) => SpawnResult | 'missing';

/** Runs git for real, and `claude` as the test describes it. */
function spawner(claude: Claude = () => 'missing', calls: string[][] = []) {
    return (command: string, args: string[], options?: SpawnOptions): Promise<SpawnResult> => {
        if (command === 'claude') {
            calls.push(args);
            const result = claude(args);
            if (result === 'missing') {
                return Promise.reject(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
            }
            return Promise.resolve(result);
        }
        try {
            const stdout = execFileSync(command, args, {
                cwd: options?.cwd,
                encoding: 'utf-8',
                stdio: 'pipe',
            });
            return Promise.resolve({ exitCode: 0, stdout, stderr: '' });
        } catch (e) {
            return Promise.resolve({ exitCode: 1, stdout: '', stderr: String(e) });
        }
    };
}

function install(input: Record<string, unknown>, claude?: Claude, calls?: string[][]) {
    return runCommandInHarness(mcpInstallDefinition, input, { spawn: spawner(claude, calls) });
}

const read = (file: string) => fs.readFileSync(file, 'utf-8');

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('vendure mcp install', () => {
    it('writes .mcp.json at the git root from a subfolder, with no absolute path', async () => {
        const root = singleProject();

        const result = await install({ client: 'claude', dir: path.join(root, 'src/plugins/reviews') });

        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: { action: 'created', project: root, file: path.join(root, '.mcp.json') },
        });
        expect(JSON.parse(read(path.join(root, '.mcp.json')))).toEqual({
            mcpServers: { vendure: { command: 'npx', args: ['--no', '--offline', '@vendure/cli', 'mcp'] } },
        });
        expect(read(path.join(root, '.mcp.json'))).not.toContain(root);
    });

    it('changes nothing when run again', async () => {
        const root = singleProject();
        await install({ client: 'claude', dir: root });
        const before = read(path.join(root, '.mcp.json'));

        const again = await install({ client: 'claude', dir: root });

        expect(again.envelope.output).toMatchObject({ action: 'unchanged' });
        expect(read(path.join(root, '.mcp.json'))).toBe(before);
    });

    it('keeps the other servers of an existing config', async () => {
        const root = singleProject();
        fs.writeFileSync(
            path.join(root, '.mcp.json'),
            JSON.stringify({ mcpServers: { other: { command: 'o' } } }),
        );

        await install({ client: 'claude', dir: root });

        expect(Object.keys(JSON.parse(read(path.join(root, '.mcp.json'))).mcpServers)).toEqual([
            'other',
            'vendure',
        ]);
    });

    it.each([
        ['vscode', '.vscode/mcp.json'],
        ['codex', '.codex/config.toml'],
    ])('writes the project config of %s', async (client, file) => {
        const root = singleProject();

        const result = await install({ client, dir: root });

        expect(result.envelope.output).toMatchObject({ action: 'created', file: path.join(root, file) });
        expect(read(path.join(root, file))).toContain('@vendure/cli');
    });

    // Cursor does not document which folder it starts a server in, and npx starts from there.
    it('prints the Cursor entry with a notice, and writes nothing', async () => {
        const root = singleProject();

        const result = await install({ client: 'cursor', dir: root });

        expect(result.envelope.output).toMatchObject({
            action: 'printed',
            config: expect.stringContaining('mcpServers'),
        });
        expect(result.envelope.notices).toEqual([expect.objectContaining({ level: 'warning' })]);
        expect(fs.existsSync(path.join(root, '.cursor'))).toBe(false);
    });

    it('writes nothing with --print', async () => {
        const root = singleProject();

        const result = await install({ client: 'claude', dir: root, print: true });

        expect(result.envelope.output).toMatchObject({ action: 'printed' });
        expect(fs.existsSync(path.join(root, '.mcp.json'))).toBe(false);
    });

    // In a pnpm monorepo without hoisting, npx started at the root finds no @vendure/cli.
    it("refuses a root that does not resolve the project's @vendure/cli, and offers --scope local", async () => {
        const root = repo({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'apps/server/package.json': vendureProject,
            'apps/server/node_modules/@vendure/cli/package.json': cli('4.0.0'),
        });

        const result = await install({ client: 'claude', dir: root });

        expect(result.envelope.error).toMatchObject({
            code: 'mcp.root-cannot-resolve-cli',
            fixes: [{ path: ['mcp', 'install'], input: { client: 'claude', scope: 'local' } }],
        });
        expect(result.envelope.error?.message).toContain('devDependency of the root package.json');
        expect(fs.existsSync(path.join(root, '.mcp.json'))).toBe(false);
    });

    // The printed entry runs the same `npx` from the root, so it would not start either.
    it('refuses to print the Cursor entry when the root does not resolve the CLI', async () => {
        const root = repo({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'apps/server/package.json': vendureProject,
            'apps/server/node_modules/@vendure/cli/package.json': cli('4.0.0'),
        });

        const result = await install({ client: 'cursor', dir: root });

        expect(result.envelope.error?.code).toBe('mcp.root-cannot-resolve-cli');
    });

    it('writes the root config of a monorepo whose root resolves the hoisted CLI', async () => {
        const root = repo({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'node_modules/@vendure/cli/package.json': cli('4.0.0'),
            'apps/server/package.json': vendureProject,
        });

        const result = await install({ client: 'claude', dir: root });

        expect(result.envelope.output).toMatchObject({
            action: 'created',
            project: path.join(root, 'apps/server'),
        });
        expect(fs.existsSync(path.join(root, '.mcp.json'))).toBe(true);
    });

    // The checked-in entry has no --dir, and the server started at the root could not choose.
    it('refuses to write a config the root cannot select the project from, and offers --scope local', async () => {
        const root = repo({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'node_modules/@vendure/cli/package.json': cli('4.0.0'),
            'apps/one/package.json': vendureProject,
            'apps/two/package.json': vendureProject,
        });

        const result = await install({ client: 'claude', dir: path.join(root, 'apps/one') });

        expect(result.envelope.error).toMatchObject({
            code: 'mcp.root-cannot-select-project',
            fixes: [{ input: { client: 'claude', dir: path.join(root, 'apps/one'), scope: 'local' } }],
        });
        expect(result.envelope.error?.message).toContain('finds more than one project');
        expect(fs.existsSync(path.join(root, '.mcp.json'))).toBe(false);
    });

    // Only Claude Code has a --scope local to offer.
    it('tells other clients to use their own user-level config at an ambiguous root', async () => {
        const root = repo({
            'package.json': JSON.stringify({ private: true, workspaces: ['apps/*'] }),
            'apps/one/package.json': vendureProject,
            'apps/two/package.json': vendureProject,
        });

        const result = await install({ client: 'vscode', dir: root });

        expect(result.envelope.error).toMatchObject({ code: 'mcp.project-ambiguous' });
        expect(result.envelope.error?.fixes).toBeUndefined();
        expect(result.envelope.error?.message).toContain('vscode user-level config');
        expect(result.envelope.error?.message).not.toContain('--scope local');
    });

    it('leaves a config it cannot read alone, and offers --print', async () => {
        const root = singleProject();
        fs.writeFileSync(path.join(root, '.mcp.json'), '{ // comment\n}');

        const result = await install({ client: 'claude', dir: root });

        expect(result.envelope.error).toMatchObject({
            code: 'mcp.config-unreadable',
            fixes: [{ input: { print: true } }],
        });
        expect(read(path.join(root, '.mcp.json'))).toBe('{ // comment\n}');
    });

    it('reports a project without its own @vendure/cli', async () => {
        const root = repo({ 'package.json': vendureProject });

        const result = await install({ client: 'claude', dir: root });

        expect(result.envelope.error).toMatchObject({ code: 'mcp.cli-not-installed' });
    });

    describe('--scope local', () => {
        it('registers the absolute binary with claude mcp add, from the git root', async () => {
            const root = singleProject();
            const calls: string[][] = [];

            const result = await install(
                { client: 'claude', dir: root, scope: 'local' },
                () => ({ exitCode: 0, stdout: '', stderr: '' }),
                calls,
            );

            expect(result.envelope.output).toMatchObject({ action: 'registered', file: null });
            expect(calls).toEqual([
                [
                    'mcp',
                    'add',
                    '--scope',
                    'local',
                    'vendure',
                    '--',
                    process.execPath,
                    path.join(root, 'node_modules/@vendure/cli/dist/cli.js'),
                    'mcp',
                    '--dir',
                    root,
                ],
            ]);
        });

        it('replaces an existing local entry when run again', async () => {
            const root = singleProject();
            const calls: string[][] = [];
            let added = false;

            const result = await install(
                { client: 'claude', dir: root, scope: 'local' },
                args => {
                    if (args[1] === 'add' && !added) {
                        added = true;
                        return {
                            exitCode: 1,
                            stdout: '',
                            stderr: 'MCP server vendure already exists in local config',
                        };
                    }
                    return { exitCode: 0, stdout: '', stderr: '' };
                },
                calls,
            );

            expect(result.envelope.output).toMatchObject({ action: 'registered' });
            expect(calls.map(args => args.slice(0, 2).join(' '))).toEqual([
                'mcp add',
                'mcp remove',
                'mcp add',
            ]);
        });

        it('returns the command to run when claude is not on the PATH', async () => {
            const root = singleProject();

            const result = await install({ client: 'claude', dir: root, scope: 'local' }, () => 'missing');

            expect(result.envelope.output).toMatchObject({
                action: 'run-yourself',
                command:
                    `cd ${root} && claude mcp add --scope local vendure -- ${process.execPath} ` +
                    `${path.join(root, 'node_modules/@vendure/cli/dist/cli.js')} mcp --dir ${root}`,
            });
        });

        it('is for Claude Code only', async () => {
            const root = singleProject();

            const result = await install({ client: 'vscode', dir: root, scope: 'local' });

            expect(result.envelope.error).toMatchObject({ code: 'mcp.scope-local-unsupported' });
        });
    });
});
