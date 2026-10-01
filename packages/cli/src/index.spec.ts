import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI package root', () => {
    it('imports the public API without commands, browser, listener, network or private packages', () => {
        const result = spawnSync(
            process.execPath,
            [
                '-r',
                'ts-node/register/transpile-only',
                '-e',
                `
            const assert = require('node:assert/strict');
            const Module = require('node:module');
            const load = Module._load;
            Module._load = function (id, ...args) {
                assert(!id.startsWith('@vendure-platform/') && !id.startsWith('@vendure-io/'));
                return load.call(this, id, ...args);
            };
            const forbidden = () => { throw new Error('Import started an operation'); };
            require('node:child_process').spawn = forbidden;
            require('node:child_process').exec = forbidden;
            require('node:net').Server.prototype.listen = forbidden;
            globalThis.fetch = forbidden;
            const cli = require(${JSON.stringify(path.join(__dirname, 'index.ts'))});
            for (const name of ['loginWithBrowser', 'refreshSession', 'ConsoleTokenGrantError']) {
                assert.equal(typeof cli[name], 'function');
            }
            assert(!Object.keys(require.cache).some(id => /[/\\\\]cli\.ts$/.test(id)));
        `,
            ],
            {
                cwd: path.join(__dirname, '..'),
                env: { ...process.env, TS_NODE_PROJECT: './tsconfig.json' },
                encoding: 'utf8',
                timeout: 10_000,
            },
        );
        expect(result.error).toBeUndefined();
        expect(result.stderr).toBe('');
        expect(result.stdout).toBe('');
        expect(result.status).toBe(0);
    });
});
