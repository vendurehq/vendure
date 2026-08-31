import fs from 'fs-extra';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConsoleCommandDependencies, ConsoleReporter, consoleCommand } from './console';
import { LINK_ID, POLLING_SECRET, manifest } from './console.fixtures';
import { getProjectLinkManifestPath } from './project-link-manifest';

let server: Server | undefined;
let projectRoot: string | undefined;

afterEach(async () => {
    if (server) {
        await new Promise<void>((resolve, reject) =>
            server?.close(error => (error ? reject(error) : resolve())),
        );
        server = undefined;
    }
    if (projectRoot) {
        fs.removeSync(projectRoot);
        projectRoot = undefined;
    }
});

describe('Console project-link integration', () => {
    it('completes the protocol against an HTTP server and writes the manifest', async () => {
        const requestBodies: unknown[] = [];
        server = createServer((request, response) => {
            void respondToProjectLinkRequest(request, response, requestBodies);
        });
        await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
        const address = server.address() as AddressInfo;
        const apiUrl = `http://127.0.0.1:${address.port}`;

        projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-integration-')));
        fs.writeJsonSync(path.join(projectRoot, 'package.json'), {
            dependencies: { '@vendure/core': '3.7.2' },
        });
        const messages: string[] = [];
        const reporter: ConsoleReporter = {
            error: message => messages.push(message),
            info: message => messages.push(message),
            success: message => messages.push(message),
            warn: message => messages.push(message),
            url: value => messages.push(value),
        };
        const dependencies: Partial<ConsoleCommandDependencies> = {
            cwd: projectRoot,
            env: {
                VENDURE_CLI_NON_INTERACTIVE: 'true',
                VENDURE_CONSOLE_LINK_URL: 'http://localhost:3000',
                VENDURE_CONSOLE_LINK_API_URL: apiUrl,
            },
            fetch: globalThis.fetch,
            isNonInteractive: () => true,
            openUrl: () => Promise.resolve(),
            prompt: () => Promise.resolve(true),
            reporter,
            sleep: () => Promise.resolve(),
        };

        expect(await consoleCommand('link', {}, dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(projectRoot))).toEqual(manifest);
        expect(fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8')).toContain(
            '!.vendure/project.json',
        );
        expect(requestBodies).toEqual([{ pollingSecret: POLLING_SECRET }]);
        expect(messages.join('\n')).not.toContain(POLLING_SECRET);
    });
});

async function respondToProjectLinkRequest(
    request: IncomingMessage,
    response: ServerResponse,
    requestBodies: unknown[],
): Promise<void> {
    const body = await readBody(request);
    if (body !== undefined) {
        requestBodies.push(body);
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'POST' && request.url === '/v1/project-links') {
        response.end(
            JSON.stringify({
                id: LINK_ID,
                state: 'pending',
                protocolVersion: 1,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                pollingSecret: POLLING_SECRET,
                verificationPath: `/?link=${LINK_ID}`,
            }),
        );
        return;
    }
    if (request.method === 'POST' && request.url === `/v1/project-links/${LINK_ID}/poll`) {
        response.end(
            JSON.stringify({
                state: 'approved',
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                manifest,
            }),
        );
        return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: 'not_found' }));
}

async function readBody(request: IncomingMessage): Promise<unknown | undefined> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
        return undefined;
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
