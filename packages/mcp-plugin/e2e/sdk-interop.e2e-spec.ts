/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

// The MCP endpoints are served relative to the configured OAuth `issuer`, and the official
// client auto-discovers every endpoint from the published metadata. The issuer must therefore be
// the real base URL the test server listens on; it is set explicitly here, though the derived
// default (localhost on the configured API port) would resolve to the same value.
const baseConfig = testConfig();
const PORT = baseConfig.apiOptions.port;
const ISSUER = `http://localhost:${PORT}`;
const TOKEN_SECRET = 'sdk-interop-test-secret';

const config = mergeConfig(baseConfig, {
    plugins: [McpPlugin.init({ oauth: { tokenSecret: TOKEN_SECRET, issuer: ISSUER } })],
});

const { server, adminClient } = createTestEnvironment(config);
const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

/**
 * A minimal in-memory {@link https://modelcontextprotocol.io | MCP} `OAuthClientProvider`.
 *
 * The official client uses this to run the whole OAuth 2.1 flow: it registers the client (DCR),
 * generates the PKCE verifier, and — instead of opening a browser — hands us the authorization URL
 * via `redirectToAuthorization`, which we capture. The test then approves consent server-side (the
 * admin path, standing in for the browser) to obtain the authorization code, and `finishAuth(code)`
 * completes the token exchange.
 */
class InMemoryOAuthProvider {
    readonly redirectUrl = 'https://example.com/mcp/callback';
    capturedAuthorizationUrl?: URL;
    private _clientInformation?: any;
    private _tokens?: any;
    private _codeVerifier?: string;
    private _discoveryState?: any;

    get clientMetadata() {
        return {
            client_name: 'sdk-interop-e2e',
            redirect_uris: [this.redirectUrl],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
        };
    }

    state() {
        return 'sdk-interop-state';
    }

    clientInformation() {
        return this._clientInformation;
    }
    saveClientInformation(info: any) {
        this._clientInformation = info;
    }

    tokens() {
        return this._tokens;
    }
    saveTokens(tokens: any) {
        this._tokens = tokens;
    }

    redirectToAuthorization(authorizationUrl: URL) {
        // Capture instead of opening a browser; consent is driven server-side below.
        this.capturedAuthorizationUrl = authorizationUrl;
    }

    saveCodeVerifier(codeVerifier: string) {
        this._codeVerifier = codeVerifier;
    }
    codeVerifier() {
        if (!this._codeVerifier) {
            throw new Error('No code verifier saved');
        }
        return this._codeVerifier;
    }

    // What the client discovered about our authorization server, stored next to the code verifier
    // because it has to survive the same redirect round-trip. When the code comes back, the client
    // re-runs discovery and refuses to send the code and verifier anywhere else, which is only
    // possible if it can read back what it recorded here (SEP-2352). A provider without these two
    // methods skips that check.
    saveDiscoveryState(state: any) {
        this._discoveryState = state;
    }
    discoveryState() {
        return this._discoveryState;
    }
}

/**
 * Approves a consent request from the test, so we get an auth code without opening the browser UI.
 *
 * Note: this signs in with a superadmin token in the header, not the login cookie the real consent
 * page uses — so it doesn't cover the page itself. The cookie path is tested in oauth-edge.e2e-spec.ts.
 */
async function approveViaAdminConsent(authorizationUrl: URL, superAdminToken: string): Promise<string> {
    const authorizeResponse = await fetch(authorizationUrl, { redirect: 'manual' });
    const consentLocation = authorizeResponse.headers.get('location');
    if (!consentLocation) {
        throw new Error(`Authorize did not redirect to consent (status ${authorizeResponse.status})`);
    }
    const requestToken = new URL(consentLocation).searchParams.get('request_token');
    if (!requestToken) {
        throw new Error(`Consent redirect missing request_token param: ${consentLocation}`);
    }
    const consentResponse = await fetch(`${baseUrl()}/mcp/oauth/admin-consent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${superAdminToken}` },
        body: JSON.stringify({ request_token: requestToken, approved: true }),
    });
    if (!consentResponse.ok) {
        throw new Error(`Admin consent failed: ${consentResponse.status} ${await consentResponse.text()}`);
    }
    const { redirectUrl } = (await consentResponse.json()) as { redirectUrl: string };
    const code = new URL(redirectUrl).searchParams.get('code');
    if (!code) {
        throw new Error(`Consent redirect missing code param: ${redirectUrl}`);
    }
    return code;
}

describe('MCP SDK interop (official @modelcontextprotocol/client 2.x)', () => {
    let superAdminToken: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('publishes protected-resource and authorization-server metadata', async () => {
        const prm = await fetch(`${baseUrl()}/.well-known/oauth-protected-resource/mcp/admin`);
        expect(prm.status).toBe(200);
        const prmBody = await prm.json();
        expect(prmBody.resource).toBe(`${ISSUER}/mcp/admin`);
        expect(prmBody.authorization_servers).toContain(ISSUER);

        const asm = await fetch(`${baseUrl()}/.well-known/oauth-authorization-server`);
        expect(asm.status).toBe(200);
        const asmBody = await asm.json();
        expect(asmBody.issuer).toBe(ISSUER);
        expect(asmBody.token_endpoint).toBe(`${ISSUER}/mcp/oauth/token`);
        expect(asmBody.registration_endpoint).toBe(`${ISSUER}/mcp/oauth/register`);
        expect(asmBody.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('an unauthenticated admin request is challenged with WWW-Authenticate: Bearer', async () => {
        const res = await fetch(`${baseUrl()}/mcp/admin`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        });
        expect(res.status).toBe(401);
        // Must carry the `resource_metadata` parameter (RFC 9728) — dropping it breaks the
        // client's automatic discovery of the protected-resource metadata document.
        expect(res.headers.get('www-authenticate') ?? '').toMatch(/^Bearer .*resource_metadata=/);
    });

    it('the official client completes the OAuth flow (DCR + PKCE + finishAuth) and calls a tool', async () => {
        const provider = new InMemoryOAuthProvider();
        const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp/admin`), {
            authProvider: provider as any,
        });
        const client = new Client({ name: 'sdk-interop-e2e', version: '1.0.0' });

        // First connect triggers discovery + DCR + PKCE, then hands us the authorization URL and
        // stops (no browser). The SDK signals this by throwing.
        await expect(client.connect(transport)).rejects.toThrow();
        expect(provider.capturedAuthorizationUrl).toBeInstanceOf(URL);
        expect(provider.clientInformation()).toBeTruthy(); // DCR registered a client_id

        // Approve consent server-side and complete the token exchange (form-urlencoded, SDK-driven).
        const code = await approveViaAdminConsent(provider.capturedAuthorizationUrl!, superAdminToken);
        await transport.finishAuth(code);
        expect(provider.tokens()?.access_token).toBeTruthy();
        expect(provider.tokens()?.refresh_token).toBeTruthy();

        // Reconnect with a fresh transport — now authenticated via the stored bearer — and exercise
        // the tool surface. A transport is single-use once started, so the reconnect needs a new
        // instance; it reads the tokens the provider persisted during finishAuth.
        const authedTransport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp/admin`), {
            authProvider: provider as any,
        });
        await client.connect(authedTransport);
        try {
            const tools = await client.listTools();
            expect(tools.tools.length).toBeGreaterThan(0);
            const result = await client.callTool({ name: 'list_orders', arguments: {} });
            expect(result.isError).not.toBe(true);
            expect(result.structuredContent).toBeDefined();
        } finally {
            await client.close();
        }
    });

    it('rotates the refresh token via a form-urlencoded token request (and rejects the old token)', async () => {
        // Obtain a grant with the SDK-driven flow, then drive refresh over the raw token endpoint
        // using an application/x-www-form-urlencoded body — proving the endpoint parses form bodies
        // (RFC 6749), not only JSON.
        const provider = new InMemoryOAuthProvider();
        const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp/admin`), {
            authProvider: provider as any,
        });
        const client = new Client({ name: 'sdk-interop-refresh', version: '1.0.0' });
        await expect(client.connect(transport)).rejects.toThrow();
        const code = await approveViaAdminConsent(provider.capturedAuthorizationUrl!, superAdminToken);
        await transport.finishAuth(code);
        await client.close();

        const clientId = provider.clientInformation()!.client_id as string;
        const firstRefresh = provider.tokens()!.refresh_token as string;

        const form = new URLSearchParams();
        form.set('grant_type', 'refresh_token');
        form.set('refresh_token', firstRefresh);
        form.set('client_id', clientId);
        form.set('resource', `${ISSUER}/mcp/admin`);

        const refreshResponse = await fetch(`${baseUrl()}/mcp/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        // The token endpoint returns 200 per RFC 6749 §5.1 (the handler overrides the NestJS
        // @Post default of 201 with @HttpCode(200)); the body carries the rotated grant.
        expect(refreshResponse.status).toBe(200);
        const rotated = (await refreshResponse.json()) as { access_token: string; refresh_token: string };
        expect(rotated.access_token).toBeTruthy();
        expect(rotated.refresh_token).toBeTruthy();
        expect(rotated.refresh_token).not.toBe(firstRefresh); // rotation

        // Replaying the old refresh token is rejected — once rotated, it's no longer on record. This
        // only proves the old token is dead, not that the whole grant is revoked; that's tested in
        // oauth-single-use.e2e-spec.ts ("revokes the whole grant when a rotated refresh token is reused").
        const replayForm = new URLSearchParams();
        replayForm.set('grant_type', 'refresh_token');
        replayForm.set('refresh_token', firstRefresh);
        replayForm.set('client_id', clientId);
        replayForm.set('resource', `${ISSUER}/mcp/admin`);
        const replayResponse = await fetch(`${baseUrl()}/mcp/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: replayForm.toString(),
        });
        expect(replayResponse.status).toBe(400);
    });
});
