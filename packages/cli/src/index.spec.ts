import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Runs in the loader thread. It fails every import of a private package or of the CLI entry point.
const resolveHooks = `
export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@vendure-platform/') || specifier.startsWith('@vendure-io/')) {
        throw new Error('Imported a private package: ' + specifier);
    }
    const result = await nextResolve(specifier, context);
    if (/[/\\\\]cli\\.ts$/.test(result.url)) {
        throw new Error('Imported the CLI entry point');
    }
    return result;
}
`;
const registerHooks = `
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('ts-node/esm', pathToFileURL('./'));
register(${JSON.stringify(`data:text/javascript,${encodeURIComponent(resolveHooks)}`)});
`;

describe('CLI package root', () => {
    it('imports the public API without commands, browser, listener, network or private packages', () => {
        const result = spawnSync(
            process.execPath,
            [
                '--no-warnings',
                '--import',
                `data:text/javascript,${encodeURIComponent(registerHooks)}`,
                '--input-type=module',
                '-e',
                `
            import assert from 'node:assert/strict';
            import childProcess from 'node:child_process';
            import Module, { syncBuiltinESMExports } from 'node:module';
            import net from 'node:net';
            const load = Module._load;
            Module._load = function (id, ...args) {
                assert(!id.startsWith('@vendure-platform/') && !id.startsWith('@vendure-io/'));
                return load.call(this, id, ...args);
            };
            const forbidden = () => { throw new Error('Import started an operation'); };
            childProcess.spawn = forbidden;
            childProcess.exec = forbidden;
            syncBuiltinESMExports();
            net.Server.prototype.listen = forbidden;
            globalThis.fetch = forbidden;
            const cli = await import(${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, 'index.ts')).href)});
            for (const name of ['loginWithBrowser', 'refreshSession', 'ConsoleTokenGrantError']) {
                assert.equal(typeof cli[name], 'function');
            }
        `,
            ],
            {
                cwd: path.join(import.meta.dirname, '..'),
                env: { ...process.env, TS_NODE_PROJECT: './tsconfig.json', TS_NODE_TRANSPILE_ONLY: 'true' },
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
