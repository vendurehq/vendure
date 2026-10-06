import fs from 'fs-extra';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConsoleCommandDependencies, consoleCommand } from './console';
import { ConsoleReporter } from './console-reporter';
import {
    NOW,
    PROJECT_ID,
    STORED_ACCESS_TOKEN,
    createCliConfigDir,
    manifest,
    projectList,
    storeLogin,
} from './console.fixtures';
import { getProjectLinkManifestPath } from './project-link-manifest';

let server: Server | undefined;
let projectRoot: string | undefined;
const temporaryDirectories: string[] = [];

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
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('Console project-link integration', () => {
    it('links with the CLI login against an HTTP server and writes the manifest', async () => {
        const requests: Array<{ method?: string; url?: string; authorization?: string }> = [];
        server = createServer((request, response) => {
            requests.push({
                method: request.method,
                url: request.url,
                authorization: request.headers.authorization,
            });
            respondToProjectLinkRequest(request, response);
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
        const env = {
            VENDURE_CLI_NON_INTERACTIVE: 'true',
            VENDURE_CONSOLE_APP_URL: 'http://localhost:3000',
            VENDURE_CONSOLE_API_URL: apiUrl,
            VENDURE_CLI_CONFIG_DIR: createCliConfigDir(temporaryDirectories),
        };
        storeLogin(env, apiUrl);
        const dependencies: Partial<ConsoleCommandDependencies> = {
            cwd: projectRoot,
            env,
            fetch: globalThis.fetch,
            isNonInteractive: () => true,
            now: () => NOW,
            openUrl: () => Promise.resolve(),
            prompt: () => Promise.resolve(true),
            reporter,
        };

        expect(await consoleCommand('link', {}, dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(projectRoot))).toEqual({
            ...manifest,
            schemaVersion: 1,
            console: {
                appOrigin: 'http://localhost:3000',
                apiOrigin: apiUrl,
            },
        });
        expect(fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8')).toContain(
            '!.vendure/project.json',
        );
        expect(requests).toEqual([
            { method: 'GET', url: '/v1/projects', authorization: `Bearer ${STORED_ACCESS_TOKEN}` },
            {
                method: 'POST',
                url: `/v1/projects/${PROJECT_ID}/link`,
                authorization: `Bearer ${STORED_ACCESS_TOKEN}`,
            },
        ]);
        expect(messages.join('\n')).not.toContain(STORED_ACCESS_TOKEN);
    });
});

function respondToProjectLinkRequest(request: IncomingMessage, response: ServerResponse): void {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== `Bearer ${STORED_ACCESS_TOKEN}`) {
        response.statusCode = 401;
        response.end(JSON.stringify({ code: 'auth.token_invalid' }));
        return;
    }
    if (request.method === 'GET' && request.url === '/v1/projects') {
        response.end(JSON.stringify(projectList()));
        return;
    }
    if (request.method === 'POST' && request.url === `/v1/projects/${PROJECT_ID}/link`) {
        response.end(JSON.stringify(manifest));
        return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: 'not_found' }));
}
