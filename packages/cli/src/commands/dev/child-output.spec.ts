import { describe, expect, it } from 'vitest';

import { stripAnsi } from '../../shared/strip-ansi.js';

import { formatLogLineAsText, isReadyLine, readChildOutputLine, readUrls } from './child-output.js';

const now = () => new Date('2026-11-22T10:00:00.000Z');

describe('readChildOutputLine()', () => {
    it('keeps a JSON log line from the DefaultLogger as it is', () => {
        const raw = JSON.stringify({
            ts: '2026-11-22T09:59:59.000Z',
            level: 'warn',
            ctx: 'ErrorHandler',
            msg: 'Not found',
            process: 'server',
            requestId: 'req-1',
            code: 'core.entity-with-id-not-found',
        });

        expect(readChildOutputLine(raw, 'stdout', 'server', now)).toEqual({
            kind: 'log',
            json: true,
            line: JSON.parse(raw),
        });
    });

    it('fills in the process of a JSON log line that has none', () => {
        const raw = JSON.stringify({ ts: '2026-11-22T09:59:59.000Z', level: 'info', msg: 'hi' });
        const read = readChildOutputLine(raw, 'stdout', 'worker', now);

        expect(read.kind === 'log' && read.line.process).toBe('worker');
    });

    it('wraps other stdout lines as info and stderr lines as error, without colours', () => {
        expect(readChildOutputLine('\u001b[32mVITE ready\u001b[39m', 'stdout', 'dashboard', now)).toEqual({
            kind: 'log',
            json: false,
            line: { ts: '2026-11-22T10:00:00.000Z', level: 'info', msg: 'VITE ready', process: 'dashboard' },
        });
        const stderr = readChildOutputLine('TSError: Unable to compile', 'stderr', 'server', now);
        expect(stderr.line.level).toBe('error');
    });

    it('wraps JSON that is not a log line', () => {
        const read = readChildOutputLine('{"hello":"world"}', 'stdout', 'server', now);

        expect(read).toMatchObject({ kind: 'log', json: false, line: { msg: '{"hello":"world"}' } });
    });

    it('reads the startup-error event line from @vendure/core', () => {
        const raw = JSON.stringify({
            vendure: 'event',
            event: 'startup-error',
            code: 'core.config.invalid-custom-fields',
            message: 'The custom field "foo" is invalid',
            fix: [{ description: 'Rename the field' }],
        });
        const read = readChildOutputLine(raw, 'stderr', 'server', now);

        expect(read).toEqual({
            kind: 'startup-error',
            event: JSON.parse(raw),
            line: {
                ts: '2026-11-22T10:00:00.000Z',
                level: 'error',
                ctx: 'StartupError',
                msg: 'The custom field "foo" is invalid',
                process: 'server',
                code: 'core.config.invalid-custom-fields',
            },
        });
    });
});

describe('isReadyLine()', () => {
    const line = (msg: string) => ({ ts: '', level: 'info' as const, msg });

    it('recognises the ready lines of the server, the worker and Vite', () => {
        expect(isReadyLine('server', line('Vendure server (v4.0.0) now running on port 3000'))).toBe(true);
        expect(isReadyLine('worker', line('Vendure Worker is ready'))).toBe(true);
        expect(isReadyLine('dashboard', line('  VITE v6.3.5  ready in 812 ms'))).toBe(true);
    });

    it('does not take a line of another process as ready', () => {
        expect(isReadyLine('worker', line('Vendure server (v4.0.0) now running on port 3000'))).toBe(false);
        expect(isReadyLine('server', line('Bootstrapping Vendure Server'))).toBe(false);
    });
});

describe('readUrls()', () => {
    const line = (msg: string) => ({ ts: '', level: 'info' as const, msg });

    it('reads the URLs of the server welcome message', () => {
        expect(readUrls('server', line('Shop API:     http://localhost:3000/shop-api'))).toEqual({
            shop: 'http://localhost:3000/shop-api',
        });
        expect(readUrls('server', line('Admin API:    http://localhost:3000/admin-api'))).toEqual({
            admin: 'http://localhost:3000/admin-api',
        });
        expect(readUrls('server', line('Dashboard UI: http://localhost:3000/dashboard'))).toEqual({
            dashboard: 'http://localhost:3000/dashboard',
        });
        expect(readUrls('server', line('MCP:          http://localhost:3000/mcp'))).toEqual({
            mcp: 'http://localhost:3000/mcp',
        });
        expect(readUrls('server', line('GraphiQL Admin: http://localhost:3000/graphiql/admin'))).toEqual({});
    });

    it('reads the local URL of the Vite dev server', () => {
        expect(readUrls('dashboard', line('  ➜  Local:   http://localhost:5173/dashboard/'))).toEqual({
            dashboard: 'http://localhost:5173/dashboard/',
        });
    });
});

describe('formatLogLineAsText()', () => {
    it('shows the level, context, code, message and stack', () => {
        const text = stripAnsi(
            formatLogLineAsText({
                ts: '2026-11-22T10:00:00.000Z',
                level: 'error',
                ctx: 'ErrorHandler',
                msg: 'Boom',
                code: 'core.boom',
                stack: 'at x',
            }),
        );

        expect(text).toMatch(/^error .+ - \[ErrorHandler\] \(core\.boom\) Boom\nat x$/);
    });
});
