/*
 * E2E tests for how `vendure mcp` finds its project and checks that it is the project's own CLI.
 * MCP clients start the server in the folder they were opened in, through
 * `npx --no --offline @vendure/cli mcp`, so the built CLI is run here from subfolders and worktrees.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { installThisCli } from './cli-test-utils.js';

const cliPath = path.join(import.meta.dirname, '..', 'dist', 'cli.js');
const roots: string[] = [];

/** A git repository holding a Vendure project, whose @vendure/cli is `cli` or this package. */
function project(cli: 'this' | 'other' | 'none' = 'this'): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-mcp-e2e-')));
    roots.push(root);
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ dependencies: { '@vendure/core': '4.0.0' } }),
    );
    fs.mkdirSync(path.join(root, 'src/plugins'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'src/plugins/.keep'), '');
    git('add', '-A');
    git('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-qm', 'init');
    installCli(root, cli);
    return root;
}

function installCli(dir: string, cli: 'this' | 'other' | 'none') {
    if (cli === 'this') {
        installThisCli(dir);
    } else if (cli === 'other') {
        const target = path.join(dir, 'node_modules/@vendure/cli');
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(
            path.join(target, 'package.json'),
            JSON.stringify({ name: '@vendure/cli', version: '3.8.0' }),
        );
    }
}

/** Starts `vendure mcp` in `cwd`, sends `initialize`, and returns the reply or the exit. */
function startMcp(cwd: string): Promise<{ reply?: any; exitCode?: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, 'mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`vendure mcp did not answer: ${stderr}`));
        }, 30_000);
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            const line = stdout.split('\n').find(l => l.trim());
            if (line && stdout.includes('\n')) {
                clearTimeout(timer);
                child.kill();
                resolve({ reply: JSON.parse(line), stderr });
            }
        });
        child.on('close', exitCode => {
            clearTimeout(timer);
            resolve({ exitCode, stderr });
        });
        const initialize = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                clientInfo: { name: 'e2e', version: '0' },
            },
        };
        child.stdin.write(`${JSON.stringify(initialize)}\n`);
    });
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe('vendure mcp project discovery', { timeout: 120_000 }, () => {
    it('serves when started in a subfolder of the project', async () => {
        const root = project();

        const { reply } = await startMcp(path.join(root, 'src/plugins'));

        expect(reply.result.serverInfo.name).toBe('vendure-developer-mcp');
    });

    it('serves when started in a git worktree, with its own install', async () => {
        const root = project();
        const worktree = path.join(root, '..', `${path.basename(root)}-worktree`);
        roots.push(worktree);
        execFileSync('git', ['worktree', 'add', '-q', worktree], { cwd: root, stdio: 'ignore' });
        installCli(worktree, 'this');

        const { reply } = await startMcp(path.join(worktree, 'src/plugins'));

        expect(reply.result.serverInfo.name).toBe('vendure-developer-mcp');
    });

    // `npx --no` runs a global @vendure/cli when the folder it starts in has none.
    it("refuses to serve a project from any @vendure/cli but the project's own", async () => {
        const root = project('other');

        const { exitCode, stderr } = await startMcp(root);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('[mcp.not-project-cli]');
        expect(stderr).toContain('installs @vendure/cli 3.8.0');
    });

    // The server could otherwise not tell which project to serve, nor check its CLI.
    it('stops at a monorepo root that holds more than one project', async () => {
        const root = project('none');
        fs.writeFileSync(
            path.join(root, 'package.json'),
            JSON.stringify({ private: true, workspaces: ['apps/*'] }),
        );
        for (const app of ['one', 'two']) {
            fs.mkdirSync(path.join(root, 'apps', app), { recursive: true });
            fs.writeFileSync(
                path.join(root, 'apps', app, 'package.json'),
                JSON.stringify({ dependencies: { '@vendure/core': '4.0.0' } }),
            );
        }

        const { exitCode, stderr } = await startMcp(root);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('[mcp.project-ambiguous]');
    });

    it('refuses to serve a project that does not install @vendure/cli', async () => {
        const root = project('none');

        const { exitCode, stderr } = await startMcp(root);

        expect(exitCode).toBe(1);
        expect(stderr).toContain('[mcp.cli-not-installed]');
    });

    it('writes .mcp.json at the git root with vendure mcp install, from a subfolder', () => {
        const root = project();

        execFileSync(process.execPath, [cliPath, 'mcp', 'install', '--client', 'claude', '--json'], {
            cwd: path.join(root, 'src/plugins'),
            stdio: 'pipe',
        });

        expect(JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf-8')).mcpServers.vendure).toEqual(
            {
                command: 'npx',
                args: ['--no', '--offline', '@vendure/cli', 'mcp'],
            },
        );
    });
});
