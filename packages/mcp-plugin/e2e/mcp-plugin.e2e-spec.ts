import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

import { callTool, postMcp, rpc } from './utils/mcp-http-client';
import { initTestServer } from './utils/test-server';

describe('McpPlugin bootstrap', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [McpPlugin.init({})],
    });
    const { server } = createTestEnvironment(config);
    const baseUrl = `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        await initTestServer(server);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // `McpPlugin.init({})` with no options is the shortest path to a working server and the one the
    // quick start leads with, so these run it over HTTP: the shop endpoint answers without a token
    // because `shopAccess` defaults to `anonymous`, and every route that needs OAuth options
    // refuses because none were supplied.
    describe('server started with no options', () => {
        it('lists the shop tools with no token', async () => {
            const response = await postMcp(baseUrl, 'shop', rpc('tools/list'));

            expect(response.status).toBe(200);
            const names = (response.body.result.tools as Array<{ name: string }>).map(tool => tool.name);
            expect(names).toContain('search_products');
        });

        it('runs a shop tool with no token', async () => {
            const response = await postMcp(baseUrl, 'shop', callTool('search_products', { query: 'test' }));

            expect(response.status).toBe(200);
            expect(response.body.result.isError).toBeUndefined();
            const result = response.body.result.structuredContent as { items: Array<{ name: string }> };
            // The seeded catalog holds exactly "Test Product" and "Test Shirt".
            expect(result.items.map(item => item.name).sort()).toEqual(['Test Product', 'Test Shirt']);
        });

        // 400, not the 401 an OAuth-configured server sends. That 401 carries a WWW-Authenticate
        // header naming the protected-resource metadata URL, and building the URL needs the OAuth
        // options this server does not have, so the attempt to build it fails first.
        it('refuses the admin endpoint with 400 rather than 401', async () => {
            const response = await postMcp(baseUrl, 'admin', rpc('tools/list'));

            expect(response.status).toBe(400);
            expect(response.headers.get('www-authenticate')).toBeNull();
        });

        // Client registration needs no credentials, so nothing else would stop it saving a row for
        // an OAuth flow this server cannot run.
        it('refuses client registration', async () => {
            const response = await fetch(`${baseUrl}/mcp/oauth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_name: 'No OAuth Client',
                    redirect_uris: ['https://example.com/cb'],
                }),
            });

            expect(response.status).toBe(400);
        });
    });
});
