import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    claudeSettings,
    DOCS_MCP_URL,
    docsServerConfig,
    renderAgentsMd,
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

    it("writes Cursor's vendure entry too, because vendure mcp install only prints it", () => {
        expect(JSON.parse(docsServerConfig('cursor')).mcpServers.vendure).toEqual({
            command: 'npx',
            args: ['--no', '--offline', '@vendure/cli', 'mcp'],
        });
    });

    it('enables both servers for Claude Code', () => {
        expect(JSON.parse(claudeSettings())).toEqual({ enabledMcpjsonServers: ['vendure', 'vendure-docs'] });
    });
});

describe('writeAgentFiles()', () => {
    const base = { name: 'shop', pmInfo: getPackageManagerInfo('npm'), storefront: undefined, assetsDir };

    it("runs the project's vendure mcp install for each client but Cursor", async () => {
        const dir = projectWithFakeCli('installs', { status: 'ok', output: { action: 'created' } });
        const result = await writeAgentFiles({
            ...base,
            agents: ['claude', 'cursor', 'codex'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: undefined,
        });

        expect(result.agents).toEqual(['claude', 'cursor', 'codex']);
        expect(result.agentFiles.failed).toEqual([]);
        expect(fs.readFileSync(path.join(dir, 'calls.log'), 'utf-8').trim().split('\n')).toEqual([
            'mcp install --client claude --json',
            'mcp install --client codex --json',
        ]);
        expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8')).toBe('@AGENTS.md\n');
        for (const skill of ['vendure-cli', 'vendure-store-setup', 'vendure-troubleshooting']) {
            expect(fs.existsSync(path.join(dir, '.agents/skills', skill, 'SKILL.md'))).toBe(true);
        }
        expect(fs.existsSync(path.join(dir, '.vscode/mcp.json'))).toBe(false);
    });

    it('reports a client whose install failed, and leaves it out of the recorded clients', async () => {
        const dir = projectWithFakeCli(
            'fails',
            { status: 'error', error: { code: 'mcp.x', message: 'The config is unreadable' } },
            1,
        );
        const result = await writeAgentFiles({
            ...base,
            agents: ['vscode'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: undefined,
        });

        expect(result.agents).toEqual([]);
        expect(result.agentFiles.failed).toEqual([{ client: 'vscode', reason: 'The config is unreadable' }]);
        expect(result.agentFiles.written).toContain('.vscode/mcp.json');
    });

    it('writes no claude files without claude, and nothing with no clients', async () => {
        const dir = path.join(workDir, 'no-claude');
        await writeAgentFiles({
            ...base,
            agents: ['cursor'],
            root: dir,
            serverDir: dir,
            mcpInstallUnavailable: 'not installed',
        });
        expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
        expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);

        const none = path.join(workDir, 'none');
        const result = await writeAgentFiles({
            ...base,
            agents: [],
            root: none,
            serverDir: none,
            mcpInstallUnavailable: undefined,
        });
        expect(result.agentFiles.written).toEqual([]);
        expect(fs.existsSync(none)).toBe(false);
    });
});
