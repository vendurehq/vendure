import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

import { createLocalTrustProject, postAdminApi, startAsDevServer } from './utils/local-trust-fixtures';
import { callTool, postMcp, rpc } from './utils/mcp-http-client';
import { testServerInit } from './utils/test-server';

const SECRET = randomBytes(32).toString('base64url');
const ME_QUERY = '{ me { identifier } }';

/**
 * Servers that must ignore the secret, however it is sent. Both run with OAuth off, as
 * `McpPlugin.init({})` leaves it, so the admin endpoint has nothing to fall back to.
 *
 * The suites run in this order on purpose. One process reads the secret once, so the server that
 * sees no secret must start before the one that is given one.
 */
describe.each([
    {
        // As on any server the CLI did not start, even next to a dev server's state file.
        name: 'a server started without the secret, next to a state file that holds it',
        stateFile: true,
        envSecret: undefined,
    },
    {
        // As on a deployed server whose environment happens to hold the variable.
        name: 'a server started with the secret in a static environment variable and no state file',
        stateFile: false,
        envSecret: SECRET,
    },
])('Local trust refused: $name', ({ stateFile, envSecret }) => {
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init({})] });
    const { server } = createTestEnvironment(config);
    const baseUrl = `http://localhost:${config.apiOptions.port}`;
    const adminApiUrl = `${baseUrl}/${config.apiOptions.adminApiPath}`;
    const project = createLocalTrustProject(stateFile ? { secret: SECRET } : undefined);

    beforeAll(async () => {
        McpPlugin.init({});
        await startAsDevServer(() => server.init(testServerInit), {
            projectDir: project.projectDir,
            secret: envSecret,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
        project.remove();
    });

    it('answers 401 on /mcp/admin to the secret', async () => {
        const listed = await postMcp(baseUrl, 'admin', rpc('tools/list'), { token: SECRET });
        expect(listed.status).toBe(401);
        expect(listed.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');

        const called = await postMcp(baseUrl, 'admin', callTool('list_channels'), { token: SECRET });
        expect(called.status).toBe(401);
    });

    it('treats the secret on the Admin API as an anonymous request', async () => {
        const result = await postAdminApi(adminApiUrl, ME_QUERY, { Authorization: `Bearer ${SECRET}` });
        expect(result.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('still serves the anonymous shop endpoint', async () => {
        const listed = await postMcp(baseUrl, 'shop', rpc('tools/list'));
        expect(listed.status).toBe(200);
    });
});
