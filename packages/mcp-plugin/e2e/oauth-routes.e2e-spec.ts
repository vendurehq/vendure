import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

describe('McpPlugin OAuth routes', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [McpPlugin.init({ oauth: { tokenSecret: 'test-secret' } })],
    });
    const { server } = createTestEnvironment(config);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('GET /.well-known/oauth-authorization-server returns 200 with required fields', async () => {
        const port = config.apiOptions.port;
        const res = await fetch(`http://localhost:${port}/.well-known/oauth-authorization-server`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('issuer');
        expect(body).toHaveProperty('token_endpoint');
        expect(body.code_challenge_methods_supported).toEqual(['S256']);
        // CIMD: MCP clients check this flag before using a URL client_id.
        expect(body.client_id_metadata_document_supported).toBe(true);
    });

    // OAuth POST routes must accept application/x-www-form-urlencoded
    // bodies (RFC 6749).
    it('POST /mcp/oauth/register parses a form-urlencoded body', async () => {
        const port = config.apiOptions.port;
        // redirect_uris is an array, so send the key twice; repeated keys parse into an array.
        const form = new URLSearchParams();
        form.append('client_name', 'Form Client');
        form.append('redirect_uris', 'https://example.com/cb');
        form.append('redirect_uris', 'https://example.com/cb2');

        const res = await fetch(`http://localhost:${port}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });

        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(300);
        const body = await res.json();
        expect(body).toHaveProperty('client_id');
        expect(body.client_name).toBe('Form Client');
        expect(body.redirect_uris).toEqual(['https://example.com/cb', 'https://example.com/cb2']);
    });
});
