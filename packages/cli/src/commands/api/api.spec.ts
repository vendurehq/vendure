import { CommandContext } from '@vendure/common/lib/command';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { GraphqlResponse } from '../../shared/local-admin-api.js';
import { stripAnsi } from '../../shared/strip-ansi.js';
import { DevServerStateFile } from '../dev/state-file.js';

import { render, run } from './api.js';
import * as schemas from './api.schema.js';

const SECRET = 'b'.repeat(43);
// The runs in these tests started now, after this test process did, like a real run.
const NOW = new Date().toISOString();

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

interface Seen {
    url?: string;
    authorization?: string;
    body?: unknown;
}

/** A local server that answers every POST with `reply`, and records what it was sent. */
async function startServer(reply: unknown): Promise<{ origin: string; seen: Seen }> {
    const seen: Seen = {};
    const server = createServer((req: IncomingMessage, res) => {
        let body = '';
        req.on('data', chunk => (body += chunk));
        req.on('end', () => {
            seen.url = req.url;
            seen.authorization = req.headers.authorization;
            seen.body = JSON.parse(body);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(reply));
        });
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function project(origin: string | undefined): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-api-'));
    directories.push(dir);
    // A Vendure project, for resolveDevServerProject.
    writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'shop', dependencies: { '@vendure/core': '4.0.0' } }),
    );
    if (origin) {
        new DevServerStateFile(dir, SECRET).write({
            status: 'ready',
            urls: { admin: `${origin}/admin-api`, shop: `${origin}/shop-api` },
            startedAt: NOW,
            restarts: 0,
            lastError: null,
            pid: process.pid,
        });
    }
    return dir;
}

function ctx(cwd: string): CommandContext {
    return {
        cwd,
        signal: new AbortController().signal,
        mcp: false,
        notice: () => undefined,
        progress: () => undefined,
        event: () => undefined,
        spawn: () => Promise.reject(new Error('not used')),
    };
}

describe('vendure api', () => {
    it('runs an Admin API operation with the per-run secret and returns data', async () => {
        const { origin, seen } = await startServer({ data: { me: { id: '1' } } });

        const result = await run(
            { target: 'admin', query: '{ me { id } }', variables: '{"a":1}' },
            ctx(project(origin)),
        );

        expect(result).toEqual({ data: { me: { id: '1' } } });
        expect(seen).toEqual({
            url: '/admin-api',
            authorization: `Bearer ${SECRET}`,
            body: { query: '{ me { id } }', variables: { a: 1 } },
        });
    });

    it('calls the Shop API anonymously', async () => {
        const { origin, seen } = await startServer({ data: { activeOrder: null } });

        const result = await run({ target: 'shop', query: '{ activeOrder { id } }' }, ctx(project(origin)));

        expect(result).toEqual({ data: { activeOrder: null } });
        expect(seen.url).toBe('/shop-api');
        expect(seen.authorization).toBeUndefined();
    });

    it('ends as failed with the errors and their extensions', async () => {
        const errors = [
            {
                message: 'Forbidden',
                extensions: { code: 'FORBIDDEN', vendureCode: 'core.forbidden', requestId: 'r-1' },
            },
        ];
        const { origin } = await startServer({ data: null, errors });

        const result = await run({ target: 'admin', query: '{ me { id } }' }, ctx(project(origin)));

        expect(result).toEqual({ vendureResult: 'failed', output: { data: null, errors } });
        expect(stripAnsi(render({ data: null, errors }))).toContain('vendure explain r-1');
    });

    it('fails with not-running, and a fix, when no dev server runs', async () => {
        const result = await run({ target: 'shop', query: '{ a }' }, ctx(project(undefined)));

        expect(result).toMatchObject({ vendureResult: 'error', code: 'devserver.not-running' });
    });

    it('fails with unreachable when the server is gone', async () => {
        const { origin } = await startServer({});
        await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));

        const result = await run({ target: 'shop', query: '{ a }' }, ctx(project(origin)));

        expect(result).toMatchObject({ code: 'devserver.unreachable' });
    });

    it('refuses variables that are not a JSON object', async () => {
        const dir = project(undefined);

        expect(await run({ target: 'admin', query: '{ a }', variables: '[1]' }, ctx(dir))).toMatchObject({
            code: 'api.invalid-variables',
        });
        expect(await run({ target: 'admin', query: '{ a }', variables: '{' }, ctx(dir))).toMatchObject({
            code: 'api.invalid-variables',
        });
    });

    it('declares an output schema that matches the GraphQL response type', () => {
        expectTypeOf<z.infer<typeof schemas.output>>().toEqualTypeOf<GraphqlResponse>();
    });
});
