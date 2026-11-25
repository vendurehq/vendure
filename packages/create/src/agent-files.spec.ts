import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    claudeSettings,
    CLIENT_CONFIG_FILES,
    cursorConfig,
    DOCS_MCP_URL,
    docsServerConfig,
    renderAgentsMd,
    withDocsServer,
    writeAgentFiles,
} from './agent-files.js';
import { getPackageManagerInfo } from './package-manager.js';
import { STOREFRONT_STARTERS } from './storefront-starters.js';

const assetsDir = path.join(import.meta.dirname, '../assets');
const template = fs.readFileSync(path.join(import.meta.dirname, '../templates/agents.hbs'), 'utf-8');
let workDir: string;

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-agent-files-'));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

/** A project whose `vendure` bin records its arguments and prints the given envelope. */
function projectWithFakeCli(name: string, envelope: unknown, exitCode = 0): string {
    const dir = path.join(workDir, name);
    const bin = path.join(dir, 'node_modules/.bin/vendure');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(
        bin,
        [
            '#!/usr/bin/env node',
            `require('fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls.log'))}, process.argv.slice(2).join(' ') + '\\n');`,
            `console.log(${JSON.stringify(JSON.stringify(envelope))});`,
            `process.exit(${exitCode});`,
        ].join('\n'),
    );
    fs.chmodSync(bin, 0o755);
    return dir;
}

describe('renderAgentsMd()', () => {
    it("uses the project's package manager for every command", () => {
        const text = renderAgentsMd(template, {
            name: 'my-shop',
            pmInfo: getPackageManagerInfo('pnpm'),
            storefront: undefined,
        });
        const lines = text.split('\n');
        expect(lines[0]).toBe('# my-shop');
        expect(text).toContain('The package manager is pnpm.');
        expect(text).toContain('- `pnpm run dev`: start the local environment.');
        expect(text).toContain('`pnpm exec vendure guide`');
        expect(text).toContain('`pnpm exec vendure migrate generate <name>`');
        expect(text).not.toMatch(/\bnpm run\b|\bnpx\b|\{\{/);
    });

    it('names the server workspace when there is a storefront', () => {
        const text = renderAgentsMd(template, {
            name: 'my-shop',
            pmInfo: getPackageManagerInfo('npm'),
            storefront: STOREFRONT_STARTERS.find(s => s.id === 'tanstack'),
        });
        expect(text).toContain('with a TanStack Start storefront in `apps/storefront`');
        expect(text).toContain('Run the `vendure` commands in `apps/server`.');
        expect(text).toContain('`apps/server/src/vendure-config.ts`');
    });
});

describe('MCP configs', () => {
    it('adds the vendure-docs server in the form each client reads', () => {
        expect(JSON.parse(docsServerConfig('claude'))).toEqual({
            mcpServers: { 'vendure-docs': { type: 'http', url: DOCS_MCP_URL } },
        });
        expect(JSON.parse(docsServerConfig('vscode'))).toEqual({
            servers: { 'vendure-docs': { type: 'http', url: DOCS_MCP_URL } },
        });
        expect(docsServerConfig('codex')).toBe(`[mcp_servers.vendure-docs]\nurl = "${DOCS_MCP_URL}"\n`);
    });

    it('adds the docs server to the entry vendure mcp install printed for Cursor', () => {
        const printed = JSON.stringify({ mcpServers: { vendure: { command: 'npx', args: ['x'] } } });
        expect(JSON.parse(cursorConfig(printed))).toEqual({
            mcpServers: { vendure: { command: 'npx', args: ['x'] }, 'vendure-docs': { url: DOCS_MCP_URL } },
        });
    });

    it('enables both servers for Claude Code', () => {
        expect(JSON.parse(claudeSettings())).toEqual({ enabledMcpjsonServers: ['vendure', 'vendure-docs'] });
    });

    it('names the config files vendure mcp install writes', () => {
        const source = fs.readFileSync(
            path.join(import.meta.dirname, '../../cli/src/commands/mcp/install/client-config.ts'),
            'utf-8',
        );
        for (const [client, file] of Object.entries(CLIENT_CONFIG_FILES)) {
            // Matches the path in the client's entry, whatever the object's layout or quotes.
            expect(source).toMatch(new RegExp(`${client}: \\{[^}]*['"]${file.replace(/\./g, '\\.')}['"]`));
        }
    });
});

describe('withDocsServer()', () => {
    it('adds the docs server and keeps the servers and keys already there', () => {
        const existing = JSON.stringify({ inputs: [], servers: { mine: { command: 'mine' } } });
        expect(JSON.parse(withDocsServer('vscode', existing))).toEqual({
            inputs: [],
            servers: { mine: { command: 'mine' }, 'vendure-docs': { type: 'http', url: DOCS_MCP_URL } },
        });
    });

    it('appends the Codex table once', () => {
        const existing = 'model = "o3"\n';
        const once = withDocsServer('codex', existing);
        expect(once).toBe(`model = "o3"\n\n[mcp_servers.vendure-docs]\nurl = "${DOCS_MCP_URL}"\n`);
        expect(withDocsServer('codex', once)).toBe(once);
    });

    it('refuses a file it cannot read', () => {
        expect(() => withDocsServer('claude', '{ not json')).toThrow();
        expect(() => withDocsServer('claude', JSON.stringify({ mcpServers: [] }))).toThrow(/mcpServers/);
    });
});

describe('writeAgentFiles()', () => {
    const base = { name: 'shop', pmInfo: getPackageManagerInfo('npm'), storefront: undefined, assetsDir };
    const printedCursorEntry = JSON.stringify({ mcpServers: { vendure: { command: 'npx' } } });

    it("runs the project's vendure mcp install for each client, and writes Cursor's printed entry", async () => {
        const dir = projectWithFakeCli('installs', {
            status: 'ok',
            output: { action: 'printed', config: printedCursorEntry },
        });
        const result = await writeAgentFiles({
            ...base,
            agents: ['claude', 'cursor', 'codex'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: undefined,
        });

        expect(result.failed).toEqual([]);
        expect(fs.readFileSync(path.join(dir, 'calls.log'), 'utf-8').trim().split('\n')).toEqual([
            'mcp install --client claude --json',
            'mcp install --client cursor --json',
            'mcp install --client codex --json',
        ]);
        expect(JSON.parse(fs.readFileSync(path.join(dir, '.cursor/mcp.json'), 'utf-8')).mcpServers).toEqual({
            vendure: { command: 'npx' },
            'vendure-docs': { url: DOCS_MCP_URL },
        });
        expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8')).toBe('@AGENTS.md\n');
        for (const skill of ['vendure-cli', 'vendure-store-setup', 'vendure-troubleshooting']) {
            expect(fs.existsSync(path.join(dir, '.agents/skills', skill, 'SKILL.md'))).toBe(true);
        }
        expect(fs.existsSync(path.join(dir, '.vscode/mcp.json'))).toBe(false);
    });

    it.each([
        [
            'an error envelope',
            { status: 'error', error: { code: 'mcp.x', message: 'The config is unreadable' } },
            1,
            'The config is unreadable',
        ],
        [
            'output that is not JSON',
            'not json',
            3,
            '`vendure mcp install --client vscode` failed: "not json"',
        ],
    ])('reports a client whose install failed with %s', async (name, envelope, code, reason) => {
        const dir = projectWithFakeCli(`fails-${code}`, envelope, code);
        const result = await writeAgentFiles({
            ...base,
            agents: ['vscode'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: undefined,
        });

        expect(result.failed).toEqual([{ client: 'vscode', reason, retryable: false }]);
        expect(result.written).toContain('.vscode/mcp.json');
    });

    it('reports a client whose install could not start', async () => {
        const dir = path.join(workDir, 'no-cli');
        // No `vendure` in the project, and none on the PATH.
        vi.stubEnv('PATH', '');
        try {
            const result = await writeAgentFiles({
                ...base,
                agents: ['codex'],
                root: dir,
                serverDir: dir,
                mcpInstallUnavailable: undefined,
            });
            expect(result.failed).toEqual([
                {
                    client: 'codex',
                    reason: expect.stringMatching(/^Could not run `vendure mcp install`/),
                    retryable: false,
                },
            ]);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it('writes the docs server alone when vendure mcp install cannot run', async () => {
        const dir = path.join(workDir, 'unavailable');
        const unavailable = { reason: 'not installed', retryable: true };
        const result = await writeAgentFiles({
            ...base,
            agents: ['cursor'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: unavailable,
        });
        // Running `vendure mcp install` again only prints Cursor's entry, so it is not retryable.
        expect(result.failed).toEqual([
            {
                client: 'cursor',
                reason: 'not installed. Run `npx vendure mcp install --client cursor` and add the entry it prints to .cursor/mcp.json',
                retryable: false,
            },
        ]);
        expect(JSON.parse(fs.readFileSync(path.join(dir, '.cursor/mcp.json'), 'utf-8')).mcpServers).toEqual({
            'vendure-docs': { url: DOCS_MCP_URL },
        });
        expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
        expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
    });

    it('reports Cursor when vendure mcp install printed no entry', async () => {
        const dir = projectWithFakeCli('no-entry', { status: 'ok', output: { action: 'printed' } });
        const result = await writeAgentFiles({
            ...base,
            agents: ['cursor'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: undefined,
        });
        expect(result.failed).toEqual([
            {
                client: 'cursor',
                reason: expect.stringMatching(/^`vendure mcp install` printed no entry\. /),
                retryable: false,
            },
        ]);
    });

    it('lists the copied skills in AGENTS.md', async () => {
        const dir = path.join(workDir, 'skills-listed');
        await writeAgentFiles({
            ...base,
            agents: ['codex'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: { reason: 'x', retryable: true },
        });
        expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf-8')).toContain(
            '- Skills in `.agents/skills/`: `vendure-cli`, `vendure-store-setup`, `vendure-troubleshooting`.',
        );
    });

    it("keeps an existing config's servers, and leaves a file it cannot read alone", async () => {
        const dir = projectWithFakeCli('existing-configs', { status: 'ok', output: { action: 'updated' } });
        fs.mkdirSync(path.join(dir, '.vscode'));
        fs.writeFileSync(
            path.join(dir, '.vscode/mcp.json'),
            JSON.stringify({ servers: { mine: { command: 'x' } } }),
        );
        fs.writeFileSync(path.join(dir, '.mcp.json'), '{ broken');
        const result = await writeAgentFiles({
            ...base,
            agents: ['claude', 'vscode'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: undefined,
        });

        expect(JSON.parse(fs.readFileSync(path.join(dir, '.vscode/mcp.json'), 'utf-8')).servers.mine).toEqual(
            {
                command: 'x',
            },
        );
        expect(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf-8')).toBe('{ broken');
        expect(result.failed).toEqual([
            {
                client: 'claude',
                reason: expect.stringMatching(/^\.mcp\.json was left as it is, because it could not be read/),
                retryable: false,
            },
        ]);
    });

    it('writes nothing with no clients', async () => {
        const none = path.join(workDir, 'none');
        const result = await writeAgentFiles({
            ...base,
            agents: [],
            root: none,
            serverDir: none,
            mcpInstallUnavailable: undefined,
        });
        expect(result.written).toEqual([]);
        expect(fs.existsSync(none)).toBe(false);
    });
});
