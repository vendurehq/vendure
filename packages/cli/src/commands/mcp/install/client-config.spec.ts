import { describe, expect, it } from 'vitest';

import { configBlock, ConfigFileUnreadable, updateClientConfig } from './client-config.js';

const ENTRY = { command: 'npx', args: ['--no', '--offline', '@vendure/cli', 'mcp'] };

describe('updateClientConfig() for JSON clients', () => {
    it('creates .mcp.json with the vendure entry for Claude Code', () => {
        const { text, action } = updateClientConfig('claude', undefined);

        expect(action).toBe('created');
        expect(JSON.parse(text)).toEqual({ mcpServers: { vendure: ENTRY } });
        expect(text.endsWith('\n')).toBe(true);
    });

    it('uses the servers key, the stdio type and the workspace folder for VS Code', () => {
        expect(JSON.parse(updateClientConfig('vscode', undefined).text)).toEqual({
            servers: { vendure: { type: 'stdio', ...ENTRY, cwd: '${workspaceFolder}' } },
        });
    });

    it('keeps the other servers and keys, and adds vendure', () => {
        const existing = JSON.stringify({ inputs: [], mcpServers: { other: { command: 'other' } } });

        const { text, action } = updateClientConfig('claude', existing);

        expect(action).toBe('created');
        expect(JSON.parse(text)).toEqual({
            inputs: [],
            mcpServers: { other: { command: 'other' }, vendure: ENTRY },
        });
    });

    it('replaces an older vendure entry, and only that one', () => {
        const existing = JSON.stringify({
            mcpServers: {
                vendure: { command: '/abs/vendure', args: ['mcp', '--dir', '/abs'] },
                other: { command: 'o' },
            },
        });

        const { text, action } = updateClientConfig('claude', existing);

        expect(action).toBe('updated');
        expect(JSON.parse(text).mcpServers).toEqual({ vendure: ENTRY, other: { command: 'o' } });
    });

    it("keeps the file's indentation", () => {
        const existing = JSON.stringify({ mcpServers: { other: { command: 'o' } } }, null, 4);

        const { text } = updateClientConfig('claude', existing);

        expect(text).toBe(
            `${JSON.stringify({ mcpServers: { other: { command: 'o' }, vendure: ENTRY } }, null, 4)}\n`,
        );
    });

    it('leaves the file as it is when the entry is already there', () => {
        const existing = updateClientConfig('claude', undefined).text.replace('\n', '\n  ');

        expect(updateClientConfig('claude', existing)).toEqual({ text: existing, action: 'unchanged' });
    });

    it.each([
        ['{ "mcpServers": { } // a comment', /not valid JSON/],
        ['[]', /not a JSON object/],
        ['{ "mcpServers": [] }', /"mcpServers" is not an object/],
    ])('refuses to rewrite %j', (existing, reason) => {
        expect(() => updateClientConfig('claude', existing)).toThrow(ConfigFileUnreadable);
        expect(() => updateClientConfig('claude', existing)).toThrow(reason);
    });
});

describe('updateClientConfig() for Codex', () => {
    const table =
        '[mcp_servers.vendure]\ncommand = "npx"\nargs = ["--no", "--offline", "@vendure/cli", "mcp"]\n';

    it('creates .codex/config.toml with the vendure table', () => {
        expect(updateClientConfig('codex', undefined)).toEqual({ text: table, action: 'created' });
    });

    it('appends the table and keeps the rest of the file, comments included', () => {
        const existing = '# project settings\nmodel = "o3"\n\n[mcp_servers.other]\ncommand = "other"\n';

        const { text, action } = updateClientConfig('codex', existing);

        expect(action).toBe('created');
        expect(text).toBe(`${existing}\n${table}`);
    });

    it('replaces the vendure table and its sub-tables, and keeps the tables after it', () => {
        const existing = [
            '[mcp_servers.vendure]',
            'command = "/abs/vendure"',
            '',
            '[mcp_servers.vendure.env]',
            'A = "1"',
            '',
            '[mcp_servers.other]',
            'command = "other"',
            '',
        ].join('\n');

        const { text, action } = updateClientConfig('codex', existing);

        expect(action).toBe('updated');
        expect(text).toBe(`${table}\n[mcp_servers.other]\ncommand = "other"\n`);
    });

    it('leaves the file as it is when the table is already there', () => {
        const existing = `model = "o3"\n\n${table}`;

        expect(updateClientConfig('codex', existing)).toEqual({ text: existing, action: 'unchanged' });
    });

    it.each([['[mcp_servers]\nvendure = { command = "npx" }\n'], ['mcp_servers.vendure.command = "npx"\n']])(
        'refuses a vendure server written in another form: %j',
        existing => {
            expect(() => updateClientConfig('codex', existing)).toThrow(
                /outside a \[mcp_servers.vendure\] table/,
            );
        },
    );

    it('treats a header with a trailing comment as the vendure table', () => {
        const existing = `[mcp_servers.vendure] # ours\ncommand = "old"\n`;

        const { text, action } = updateClientConfig('codex', existing);

        expect(action).toBe('updated');
        expect(text.match(/\[mcp_servers\.vendure\]/g)).toHaveLength(1);
    });

    // A second table for the same server would leave the file invalid.
    it('updates a quoted vendure header in place', () => {
        const { text, action } = updateClientConfig('codex', '[mcp_servers."vendure"]\ncommand = "old"\n');

        expect(action).toBe('updated');
        expect(text).toBe(table);
    });

    // `@vendure/create` writes this table before it runs `vendure mcp install`.
    it('adds the table beside a server whose url names a vendure.* host', () => {
        const existing = '[mcp_servers.vendure-docs]\nurl = "https://docs.vendure.io/mcp"\n';

        const { text, action } = updateClientConfig('codex', existing);

        expect(action).toBe('created');
        expect(text).toBe(`${existing}\n${table}`);
    });

    it('leaves other tables that mention vendure alone', () => {
        const existing =
            '[projects."/home/me/vendure-shop"]\ntrust_level = "trusted"\n\n[mcp_servers.vendure-docs]\ncommand = "docs"\n';

        const { text, action } = updateClientConfig('codex', existing);

        expect(action).toBe('created');
        expect(text).toBe(`${existing}\n${table}`);
    });

    it('keeps the comments and blank lines before the next table', () => {
        const existing =
            '[mcp_servers.vendure]\ncommand = "old"\n\n# Docs server, keep me\n[mcp_servers.docs]\ncommand = "docs"\n';

        const { text } = updateClientConfig('codex', existing);

        expect(text).toBe(`${table}\n# Docs server, keep me\n[mcp_servers.docs]\ncommand = "docs"\n`);
    });

    it('does not mistake a value that mentions vendure for the server', () => {
        const existing = '[mcp_servers.other]\nargs = ["vendure", "vendure.json"]\n';

        expect(updateClientConfig('codex', existing).action).toBe('created');
    });
});

describe('configBlock()', () => {
    it('is the entry on its own, as --print shows it', () => {
        expect(JSON.parse(configBlock('cursor'))).toEqual({ mcpServers: { vendure: ENTRY } });
    });
});
