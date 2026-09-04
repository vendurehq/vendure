import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

import { exchangeCode, runAuthorizationCodeFlowToCode } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

describe('McpPlugin OAuth routes', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [McpPlugin.init({ oauth: { tokenSecret: 'test-secret' } })],
    });
    const { server, adminClient } = createTestEnvironment(config);

    beforeAll(async () => {
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('GET /.well-known/oauth-authorization-server returns 200 with required fields', async () => {
        const port = config.apiOptions.port;
        const res = await fetch(`http://localhost:${port}/.well-known/oauth-authorization-server`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            code_challenge_methods_supported: string[];
            client_id_metadata_document_supported: boolean;
        };
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
        const body = (await res.json()) as { client_name: string; redirect_uris: string[] };
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

    // RFC 6749 §5.2: a failed token request answers with an `error` code and an
    // `error_description`, and nothing else. A client keys on `error` to tell "these
    // credentials are dead, start a new authorization" from "I sent the wrong thing".
    it('POST /mcp/oauth/token answers a failure with the RFC 6749 error body', async () => {
        const port = config.apiOptions.port;
        const postToken = (form: URLSearchParams) =>
            fetch(`http://localhost:${port}/mcp/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: form.toString(),
            });

        const badCode = new URLSearchParams({
            grant_type: 'authorization_code',
            code: 'not-a-real-code',
            client_id: 'not-a-real-client',
            redirect_uri: 'https://example.com/cb',
            code_verifier: 'x'.repeat(43),
            resource: `http://localhost:${port}/mcp/admin`,
        });
        const badCodeRes = await postToken(badCode);
        expect(badCodeRes.status).toBe(400);
        expect(await badCodeRes.json()).toEqual({
            error: 'invalid_grant',
            error_description: 'Authorization code invalid or expired',
        });

        const badGrantType = new URLSearchParams({ grant_type: 'client_credentials' });
        const badGrantTypeRes = await postToken(badGrantType);
        expect(badGrantTypeRes.status).toBe(400);
        expect(await badGrantTypeRes.json()).toEqual({
            error: 'unsupported_grant_type',
            error_description: 'Unsupported grant_type',
        });
    });

    // RFC 7591 §3.2.2: a refused registration answers with `invalid_client_metadata` or
    // `invalid_redirect_uri` plus an `error_description`.
    it('POST /mcp/oauth/register answers a failure with the RFC 7591 error body', async () => {
        const port = config.apiOptions.port;
        const postRegister = (body: Record<string, unknown>) =>
            fetch(`http://localhost:${port}/mcp/oauth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

        const noName = await postRegister({ redirect_uris: ['https://example.com/cb'] });
        expect(noName.status).toBe(400);
        expect(await noName.json()).toEqual({
            error: 'invalid_client_metadata',
            error_description: 'client_name is required',
        });

        const badRedirect = await postRegister({
            client_name: 'Bad Redirect Client',
            redirect_uris: ['javascript:alert(1)'],
        });
        expect(badRedirect.status).toBe(400);
        expect(await badRedirect.json()).toEqual({
            error: 'invalid_redirect_uri',
            error_description: 'redirect_uri must not use the javascript: scheme',
        });
    });

    // Route inputs are whatever the client put on the wire, and there is no REST validation
    // pipe in the framework to check them. A field of the wrong runtime type (a string where an
    // array belongs, or a repeated query key that parses into an array) must be refused at the
    // route boundary with the RFC error body, not crash deeper in the service as a 500.
    describe('rejects route inputs of the wrong runtime type', () => {
        const postJson = (path: string, body: unknown) =>
            fetch(`http://localhost:${config.apiOptions.port}/${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

        const errorCodeOf = async (res: Response) => ((await res.json()) as { error: string }).error;

        it('POST /mcp/oauth/register refuses a string grant_types', async () => {
            const res = await postJson('mcp/oauth/register', {
                client_name: 'String Grant Types Client',
                redirect_uris: ['https://example.com/cb'],
                grant_types: 'authorization_code',
            });
            expect(res.status).toBe(400);
            expect(await errorCodeOf(res)).toBe('invalid_client_metadata');
        });

        it('POST /mcp/oauth/token refuses a numeric code', async () => {
            const res = await postJson('mcp/oauth/token', {
                grant_type: 'authorization_code',
                code: 5,
                client_id: 'not-a-real-client',
                redirect_uri: 'https://example.com/cb',
                code_verifier: 'x'.repeat(43),
            });
            expect(res.status).toBe(400);
            expect(await errorCodeOf(res)).toBe('invalid_request');
        });

        it('GET /mcp/oauth/authorize refuses a repeated state, without redirecting', async () => {
            const port = config.apiOptions.port;
            // Everything but `state` is valid, so without the check the request would get as far
            // as writing the array into the authorization request row.
            const register = await postJson('mcp/oauth/register', {
                client_name: 'Repeated State Client',
                redirect_uris: ['https://example.com/cb'],
            });
            expect(register.status).toBe(201);
            const { client_id: clientId } = (await register.json()) as { client_id: string };

            const params = new URLSearchParams({
                response_type: 'code',
                client_id: clientId,
                redirect_uri: 'https://example.com/cb',
                code_challenge: 'x'.repeat(43),
                code_challenge_method: 'S256',
                resource: `http://localhost:${port}/mcp/admin`,
            });
            params.append('state', 'a');
            params.append('state', 'b');

            const res = await fetch(`http://localhost:${port}/mcp/oauth/authorize?${params.toString()}`, {
                redirect: 'manual',
            });
            expect(res.status).toBe(400);
            expect(await errorCodeOf(res)).toBe('invalid_request');
        });

        it('GET /mcp/oauth/authorization-request refuses a repeated request_token', async () => {
            const port = config.apiOptions.port;
            const res = await fetch(
                `http://localhost:${port}/mcp/oauth/authorization-request?request_token=a&request_token=b`,
            );
            expect(res.status).toBe(400);
            expect(await errorCodeOf(res)).toBe('invalid_request');
        });
    });

    // RFC 6749 §5.1: a response that carries or refuses a credential must not be cached, so
    // no proxy or browser can hand it to somebody else.
    it('sends no-store on both a successful token response and a refused registration', async () => {
        const port = config.apiOptions.port;
        const baseUrl = `http://localhost:${port}`;
        const pending = await runAuthorizationCodeFlowToCode({
            baseUrl,
            issuer: baseUrl,
            superAdminToken: adminClient.getAuthToken(),
        });
        const tokenRes = await exchangeCode({
            baseUrl,
            body: {
                grant_type: 'authorization_code',
                code: pending.code,
                client_id: pending.client_id,
                redirect_uri: pending.redirect_uri,
                code_verifier: pending.code_verifier,
                resource: pending.resource,
            },
        });
        expect(tokenRes.status).toBe(200);
        expect(tokenRes.headers.get('cache-control')).toBe('no-store');
        expect(tokenRes.headers.get('pragma')).toBe('no-cache');

        const refusedRegister = await fetch(`${baseUrl}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ redirect_uris: ['https://example.com/cb'] }),
        });
        expect(refusedRegister.status).toBe(400);
        expect(refusedRegister.headers.get('cache-control')).toBe('no-store');
        expect(refusedRegister.headers.get('pragma')).toBe('no-cache');
    });

    // Metadata must 404 for a resource this server doesn't host, not fabricate a document for it.
    it('GET /.well-known/oauth-protected-resource/mcp/bogus returns 404', async () => {
        const port = config.apiOptions.port;
        const res = await fetch(`http://localhost:${port}/.well-known/oauth-protected-resource/mcp/bogus`);
        expect(res.status).toBe(404);
    });
});
