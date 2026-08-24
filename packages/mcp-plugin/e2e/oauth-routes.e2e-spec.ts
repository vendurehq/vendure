import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

import { testServerInit } from './utils/test-server';

describe('McpPlugin OAuth routes', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [McpPlugin.init({ oauth: { tokenSecret: 'test-secret' } })],
    });
    const { server } = createTestEnvironment(config);

    beforeAll(async () => {
        await server.init(testServerInit);
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

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body).toHaveProperty('client_id');
        expect(body.client_name).toBe('Form Client');
        expect(body.redirect_uris).toEqual(['https://example.com/cb', 'https://example.com/cb2']);
    });

    // RFC 7009 §2.2: revocation must answer 200, even for a token the server never issued —
    // the client can't distinguish "already revoked" from "never existed" either way.
    it('POST /mcp/oauth/revoke returns 200 for an unknown token', async () => {
        const port = config.apiOptions.port;
        const form = new URLSearchParams();
        form.append('token', 'unknown-bogus-token');

        const res = await fetch(`http://localhost:${port}/mcp/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });

        expect(res.status).toBe(200);
    });

    // Metadata must 404 for a resource this server doesn't host, not fabricate a document for it.
    it('GET /.well-known/oauth-protected-resource/mcp/bogus returns 404', async () => {
        const port = config.apiOptions.port;
        const res = await fetch(`http://localhost:${port}/.well-known/oauth-protected-resource/mcp/bogus`);
        expect(res.status).toBe(404);
    });
});
