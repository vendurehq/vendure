import {
    Administrator,
    Channel,
    Customer,
    mergeConfig,
    Permission,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import crypto from 'crypto';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { mcpServerPermission } from '../src/constants';
import { McpAuthorizationCode } from '../src/entities/mcp-authorization-code.entity';
import { McpAuthorizationRequest } from '../src/entities/mcp-authorization-request.entity';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpOauthService } from '../src/oauth/oauth.service';
import { deriveHashKey, hashToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';

import {
    runAuthorizationCodeFlow,
    runShopAuthorizationCodeFlow,
    submitAdminConsent,
} from './utils/oauth-test-client';

const TOKEN_SECRET = 'test-secret';
// The issuer the plugin derives when none is configured: localhost on the configured API port.
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;

describe('McpPlugin OAuth edge & security cases', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [
            McpPlugin.init({
                oauth: {
                    tokenSecret: TOKEN_SECRET,
                    storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
                },
                // This suite drives dozens of real OAuth HTTP calls well within the 60s fixed
                // window; it isn't testing rate limiting, so the default oauthIp budget is off.
                rateLimits: { oauthIp: false },
            }),
        ],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);

    // Mirrors McpOauthService.hashLookup: the value stored in a token/code column is the
    // keyed HMAC of `lookup:<plaintext>`. Used to find rows for DB-level tampering.
    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashToken(`lookup:${value}`, hashKey);

    let superAdminToken: string;
    let customerAuthToken: string;

    beforeAll(async () => {
        // Multiple test servers in this file share the McpPlugin class's static options field
        // (read at bootstrap), so this describe must reassert its own oauth config immediately
        // before booting its server.
        McpPlugin.init({
            oauth: {
                tokenSecret: TOKEN_SECRET,
                storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
            },
            rateLimits: { oauthIp: false },
        });
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
            customerCount: 1,
        });
        // Superadmin bearer approves admin consent; it stands in for an authenticated admin.
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();

        // Log in a real seeded customer on the shop client to obtain a customer session
        // token. The storefront consent step approves the grant with this token.
        const { customers } = await adminClient.query<{
            customers: { items: Array<{ emailAddress: string }> };
        }>(gql`
            query {
                customers(options: { take: 1 }) {
                    items {
                        emailAddress
                    }
                }
            }
        `);
        const customerEmail = customers.items[0]?.emailAddress;
        if (!customerEmail) {
            throw new Error('Expected at least one seeded customer');
        }
        const login = await shopClient.asUserWithCredentials(customerEmail, 'test');
        if (!login || login.errorCode) {
            throw new Error(`Customer login failed: ${JSON.stringify(login)}`);
        }
        customerAuthToken = shopClient.getAuthToken();
        if (!customerAuthToken) {
            throw new Error('Customer login did not yield a session token');
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    /** Runs the full admin authorization-code flow and returns the resulting values. */
    const runAdminFlow = (redirectUri?: string) =>
        runAuthorizationCodeFlow({ baseUrl: baseUrl(), issuer: ISSUER, superAdminToken, redirectUri });

    /** Runs the full shop authorization-code flow with the real customer session token. */
    const runShopFlow = () =>
        runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: customerAuthToken,
        });

    // Drives DCR + authorize + admin consent and stops at the freshly created code, so a
    // test can craft its own token-exchange request. The code has not yet been consumed.
    const authorizeAdminToCode = async (overrides?: { redirectUri?: string; resource?: string }) => {
        const redirectUri = overrides?.redirectUri ?? 'https://example.com/cb';
        const code_verifier = 'a'.repeat(64);
        const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        const resource = overrides?.resource ?? `${ISSUER}/mcp/admin`;

        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `edge-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            }),
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', code_challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', resource);
        const authorizeRes = await fetch(authorizeUrl, { redirect: 'manual' });
        const consentLocation = authorizeRes.headers.get('location');
        if (!consentLocation) {
            throw new Error(`Authorize did not redirect (status ${authorizeRes.status})`);
        }
        const request_token = new URL(consentLocation).searchParams.get('request_token');
        if (!request_token) {
            throw new Error(`Consent redirect missing request_token: ${consentLocation}`);
        }

        const consentBody = await submitAdminConsent({
            baseUrl: baseUrl(),
            superAdminToken,
            requestToken: request_token,
            approved: true,
        });
        if (!consentBody.data?.authorizeMcpClient) {
            throw new Error(`Admin consent failed: ${consentBody.errors?.[0]?.message ?? 'unknown error'}`);
        }
        const { redirectUrl } = consentBody.data.authorizeMcpClient;
        const code = new URL(redirectUrl).searchParams.get('code');
        if (!code) {
            throw new Error(`Consent redirect missing code: ${redirectUrl}`);
        }

        return { client_id, redirect_uri: redirectUri, code, code_verifier, resource };
    };

    // --- Rejection gates at token exchange ---

    // A token request with the wrong PKCE verifier is rejected.
    it('rejects token exchange with an invalid PKCE verifier', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCode();

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: flow.redirect_uri,
                code_verifier: 'b'.repeat(64), // wrong verifier
                resource: flow.resource,
            }),
        ).rejects.toThrow(/PKCE/i);
    });

    // A token request whose client_id differs from the code's is rejected.
    it('rejects token exchange with a client_id that does not match the code', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCode();

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: 'some-other-client',
                redirect_uri: flow.redirect_uri,
                code_verifier: flow.code_verifier,
                resource: flow.resource,
            }),
        ).rejects.toThrow(/does not match client/i);
    });

    // A redirect_uri not registered for the client is rejected at authorize.
    it('rejects authorize when redirect_uri is not registered for the client', async () => {
        const redirectUri = 'https://example.com/registered';
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `unregistered-redirect-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            }),
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const code_verifier = 'a'.repeat(64);
        const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        // A redirect_uri the client never registered.
        authorizeUrl.searchParams.set('redirect_uri', 'https://evil.example.com/cb');
        authorizeUrl.searchParams.set('code_challenge', code_challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/admin`);

        const res = await fetch(authorizeUrl, { redirect: 'manual' });
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/redirect_uri is not registered/i);
    });

    // A token request whose redirect_uri differs from the code's is rejected.
    it('rejects token exchange when redirect_uri does not match the authorization code', async () => {
        const oauth = server.app.get(McpOauthService);
        // The code is bound to this redirect_uri at authorize time.
        const flow = await authorizeAdminToCode({ redirectUri: 'https://example.com/code-uri' });

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: 'https://example.com/different-uri', // not the redirect_uri the code carries
                code_verifier: flow.code_verifier,
                resource: flow.resource,
            }),
        ).rejects.toThrow(/does not match client or redirect_uri/i);
    });

    // Authorize without a `resource` parameter is rejected.
    it('rejects authorize when the resource parameter is missing', async () => {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `no-resource-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            }),
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const code_verifier = 'a'.repeat(64);
        const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', code_challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        // Deliberately omit the `resource` parameter.

        const res = await fetch(authorizeUrl, { redirect: 'manual' });
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/resource is required/i);
    });

    // A token request without a `resource` is rejected.
    it('rejects token exchange when the resource is missing', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCode();

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: flow.redirect_uri,
                code_verifier: flow.code_verifier,
                resource: undefined,
            }),
        ).rejects.toThrow(/resource (is|are) required|are required/i);
    });

    // A token request whose resource differs from the code's is rejected.
    it('rejects token exchange when the requested resource does not match the code', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCode(); // code bound to the admin resource

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: flow.redirect_uri,
                code_verifier: flow.code_verifier,
                resource: `${ISSUER}/mcp/shop`, // valid, but not the code's resource
            }),
        ).rejects.toThrow(/does not match token request resource/i);
    });

    // A refresh request whose resource differs from the token's is rejected.
    it('rejects a refresh-token exchange when the resource does not match', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await runAdminFlow(); // admin tokens, resource = ${ISSUER}/mcp/admin

        await expect(
            oauth.exchangeToken({
                grant_type: 'refresh_token',
                refresh_token: flow.refresh_token,
                client_id: flow.client_id,
                resource: `${ISSUER}/mcp/shop`, // valid, but not the token's resource
            }),
        ).rejects.toThrow(/does not match token request resource/i);
    });

    // An authorization code past its expiry is rejected on exchange.
    it('rejects an expired authorization code', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const flow = await authorizeAdminToCode();

        // The stored code is the lookup-hash of the plaintext; expire it directly in the DB.
        const repo = connection.getRepository(ctx, McpAuthorizationCode);
        const stored = await repo.findOneOrFail({ where: { code: lookupHash(flow.code) } });
        stored.expiresAt = new Date(Date.now() - 1000);
        await repo.save(stored);

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: flow.redirect_uri,
                code_verifier: flow.code_verifier,
                resource: flow.resource,
            }),
        ).rejects.toThrow(/invalid or expired/i);
    });

    // --- Client-controlled value length / format validation ---
    //
    // These values are client-controlled and land in default-length (255-char) varchar
    // columns. On MySQL/Postgres an over-long value would otherwise throw at insert time
    // (an unhandled 500); SQLite ignores column lengths, so only an explicit check catches
    // this. Each case below is rejected before any row is written.

    // An over-long `state` is rejected with an error redirect rather than reaching the
    // McpAuthorizationRequest.state column. The state is still echoed back on the redirect —
    // it never reaches the database on this path.
    it('rejects authorize with a state longer than 255 characters', async () => {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `long-state-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            }),
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const longState = 'x'.repeat(300);
        const code_verifier = 'a'.repeat(64);
        const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', code_challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/admin`);
        authorizeUrl.searchParams.set('state', longState);

        const res = await fetch(authorizeUrl, { redirect: 'manual' });
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('location') as string);
        expect(location.searchParams.get('error')).toBe('invalid_request');
        expect(location.searchParams.get('state')).toBe(longState);
    });

    // A code_challenge outside PKCE's 43-128 character range (RFC 7636 §4.2) is rejected
    // with an error redirect, whether too short or too long.
    it.each([
        ['too short', 'x'.repeat(20)],
        ['too long', 'x'.repeat(200)],
    ])('rejects authorize with a code_challenge that is %s', async (_label, codeChallenge) => {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `bad-challenge-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            }),
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', codeChallenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/admin`);

        const res = await fetch(authorizeUrl, { redirect: 'manual' });
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('location') as string);
        expect(location.searchParams.get('error')).toBe('invalid_request');
        expect(location.searchParams.get('error_description')).toMatch(/code_challenge/i);
    });

    // DCR rejects a redirect_uri that would overflow the column it is stored in.
    it('rejects DCR registration with a redirect_uri longer than 255 characters', async () => {
        const longRedirectUri = `https://example.com/${'x'.repeat(300)}`;
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `long-redirect-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [longRedirectUri],
            }),
        });
        expect(registerRes.status).toBe(400);
    });

    // DCR drops an unusable client_uri/logo_uri rather than failing the whole registration:
    // an over-long client_uri and a non-https logo_uri are both stored as null.
    it('drops an over-long client_uri and a non-https logo_uri instead of failing registration', async () => {
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `bad-display-fields-${Math.random().toString(36).slice(2)}`,
                redirect_uris: ['https://example.com/cb'],
                client_uri: `https://example.com/${'x'.repeat(300)}`,
                logo_uri: 'javascript:alert(1)',
            }),
        });
        expect(registerRes.status).toBe(201);
        const body = (await registerRes.json()) as Record<string, unknown>;
        expect(body.client_uri).toBeUndefined();
        expect(body.logo_uri).toBeUndefined();
    });

    // DCR only advertises "none" as a supported token_endpoint_auth_method; any other value
    // is refused rather than stored unvalidated.
    it('rejects DCR registration with an unsupported token_endpoint_auth_method', async () => {
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `bad-auth-method-${Math.random().toString(36).slice(2)}`,
                redirect_uris: ['https://example.com/cb'],
                token_endpoint_auth_method: 'client_secret_basic',
            }),
        });
        expect(registerRes.status).toBe(400);
    });

    // --- Security checks ---

    // revoke() is a soft-revoke: the grant row survives (so McpToolCallLog audit links are
    // preserved) with revokedAt set, and the token is rejected at the resource afterwards.
    it('soft-revokes the grant: keeps the row with revokedAt set and rejects the token', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });
        const flow = await runAdminFlow();

        // Sanity: the token authenticates before revocation.
        const ok = await oauth.authenticateBearerToken(flow.access_token, 'admin');
        expect(ok.ctx.apiType).toBe('admin');

        await oauth.revoke(flow.access_token);

        // Soft revoke: the row is kept (not deleted) with revokedAt stamped.
        const grant = await connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: lookupHash(flow.access_token) } });
        expect(grant).toBeTruthy();
        expect(grant?.revokedAt).toBeTruthy();

        await expect(oauth.authenticateBearerToken(flow.access_token, 'admin')).rejects.toThrow(
            /invalid or expired/i,
        );
    });

    // A token whose stored resource has been tampered with is rejected on the resource gate,
    // even though the token itself is otherwise valid.
    it('rejects an access token whose stored resource has been tampered with', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const flow = await runAdminFlow();

        // Mutate the persisted resource to a different (but well-formed) value.
        const repo = connection.getRepository(ctx, McpOauthGrant);
        const stored = await repo.findOneOrFail({
            where: { accessTokenHash: lookupHash(flow.access_token) },
        });
        stored.resource = `${ISSUER}/mcp/shop`;
        await repo.save(stored);

        await expect(oauth.authenticateBearerToken(flow.access_token, 'admin')).rejects.toThrow(
            /not issued for this MCP resource/i,
        );
    });

    // Admin consent without an authenticated admin session is rejected.
    it('rejects admin consent from an unauthenticated caller', async () => {
        const flow = await authorizeAdminToCodePreConsent();

        // No Authorization header: the request is anonymous, not an admin.
        const body = await submitAdminConsent({
            baseUrl: baseUrl(),
            requestToken: flow.request_token,
            approved: true,
        });
        expect(body.data?.authorizeMcpClient).toBeUndefined();
        expect(body.errors?.[0]?.message).toMatch(/not currently authorized/i);
    });

    // Builds an admin RequestContext authenticated as if by a session cookie: a
    // session with a user, and NO Authorization header on the request (unless the
    // caller opts in via `authorization`), with a caller-supplied Origin. This is
    // exactly the shape the CSRF gate inspects.
    const buildCookieAuthedAdminCtx = ({
        origin,
        permissions = [mcpServerPermission.Update],
        authorization,
    }: {
        origin: string;
        permissions?: Permission[];
        authorization?: string;
    }) =>
        new RequestContext({
            apiType: 'admin',
            channel: new Channel({ id: 1 }),
            session: {
                token: 'mcp-test-session',
                user: { id: 1, channelPermissions: [{ id: 1, permissions }] },
            } as any,
            req: { headers: { origin, ...(authorization ? { authorization } : {}) } } as any,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });

    it('rejects cookie-authenticated admin consent from a foreign origin', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCodePreConsent();
        const ctx = buildCookieAuthedAdminCtx({ origin: 'https://evil.example' });

        await expect(oauth.approveAdminRequest(ctx, flow.request_token, true)).rejects.toThrow(
            /consent page/i,
        );
    });

    // An `Authorization` header must not exempt a request from the origin check. Vendure
    // authenticates via the session cookie before it looks at `Authorization` (core's
    // extractSessionToken), so a page on another site can attach a meaningless `Authorization`
    // value, still ride the administrator's cookie, and would otherwise bypass the CSRF gate
    // entirely.
    it('rejects cookie-authenticated admin consent from a foreign origin even with an Authorization header', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCodePreConsent();
        const ctx = buildCookieAuthedAdminCtx({
            origin: 'https://evil.example',
            authorization: 'Bearer meaningless-value',
        });

        await expect(oauth.approveAdminRequest(ctx, flow.request_token, true)).rejects.toThrow(
            /consent page/i,
        );
    });

    // The same cookie-authenticated consent from the issuer's own origin (the real consent
    // page) is allowed and creates an authorization code.
    it('allows cookie-authenticated admin consent from the consent page origin', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCodePreConsent();
        const ctx = buildCookieAuthedAdminCtx({ origin: ISSUER });

        const { redirectUrl } = await oauth.approveAdminRequest(ctx, flow.request_token, true);
        expect(new URL(redirectUrl).searchParams.get('code')).toBeTruthy();
    });

    // "admin consent" must require an actual admin permission, not merely an authenticated
    // session. A signed-in principal without UpdateMcpServer (e.g. a shop customer on the same
    // origin) is rejected even from the correct consent origin.
    it('rejects cookie-authenticated consent from a caller lacking the McpServer permission', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCodePreConsent();
        const ctx = buildCookieAuthedAdminCtx({ origin: ISSUER, permissions: [] });

        await expect(oauth.approveAdminRequest(ctx, flow.request_token, true)).rejects.toThrow(/permission/i);
    });

    // Admin consent with `approved: false` returns an access_denied redirect and creates no
    // authorization code.
    it('returns access_denied (and no code) when admin consent is not approved', async () => {
        const flow = await authorizeAdminToCodePreConsent();

        const body = await submitAdminConsent({
            baseUrl: baseUrl(),
            superAdminToken,
            requestToken: flow.request_token,
            approved: false,
        });
        const redirectUrl = body.data?.authorizeMcpClient?.redirectUrl;
        if (!redirectUrl) {
            throw new Error(`Denial failed: ${body.errors?.[0]?.message ?? 'unknown error'}`);
        }
        const url = new URL(redirectUrl);
        expect(url.searchParams.get('error')).toBe('access_denied');
        expect(url.searchParams.get('code')).toBeNull();
    });

    // A non-boolean `approved` (the string "false") never approves: GraphQL's Boolean!
    // type rejects it at variable validation, so the request is neither approved nor denied.
    it('rejects a string "false" approved value without approving', async () => {
        const flow = await authorizeAdminToCodePreConsent();

        const body = await submitAdminConsent({
            baseUrl: baseUrl(),
            superAdminToken,
            requestToken: flow.request_token,
            approved: 'false' as unknown as boolean,
        });
        expect(body.data?.authorizeMcpClient).toBeUndefined();
        expect(body.errors?.length).toBeGreaterThan(0);
    });

    // --- Shop happy path ---

    // The full shop flow issues tokens that authenticate as the customer.
    it('issues a shop token via the full storefront flow and authenticates the customer', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await runShopFlow();
        expect(flow.access_token).toBeTruthy();
        expect(flow.refresh_token).toBeTruthy();

        const authenticated = await oauth.authenticateBearerToken(flow.access_token, 'shop');
        expect(authenticated.ctx.apiType).toBe('shop');
        expect(authenticated.grant.userType).toBe('customer');
        expect(authenticated.ctx.activeUserId).toBe(authenticated.grant.userId);
        expect(authenticated.grant.userId).toBeTruthy();
    });

    describe('authorizeMcpClient mutation', () => {
        const APPROVE = gql`
            mutation ApproveMcp($requestToken: String!, $approved: Boolean!) {
                authorizeMcpClient(requestToken: $requestToken, approved: $approved) {
                    redirectUrl
                }
            }
        `;

        /**
         * Starts an authorization for the shop resource and returns the request token the
         * consent page would receive, plus the client id and PKCE verifier needed to finish.
         */
        async function startShopAuthorization(redirectUri = 'https://example.com/cb') {
            const code_verifier = 'a'.repeat(64);
            const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
            const registerResponse = await fetch(`${baseUrl()}/mcp/oauth/register`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    client_name: `approve-test-${Math.random().toString(36).slice(2)}`,
                    redirect_uris: [redirectUri],
                }),
            });
            const { client_id } = (await registerResponse.json()) as { client_id: string };

            const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
            authorizeUrl.searchParams.set('response_type', 'code');
            authorizeUrl.searchParams.set('client_id', client_id);
            authorizeUrl.searchParams.set('redirect_uri', redirectUri);
            authorizeUrl.searchParams.set('code_challenge', code_challenge);
            authorizeUrl.searchParams.set('code_challenge_method', 'S256');
            authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/shop`);
            authorizeUrl.searchParams.set('state', 'state-abc');
            const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
            const requestToken = extractRequestToken(authorizeResponse.headers.get('location'));
            return { requestToken, client_id, code_verifier, redirectUri };
        }

        it('approves for a signed-in customer and returns a redirect carrying a code', async () => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { requestToken } = await startShopAuthorization();

            const { authorizeMcpClient } = await shopClient.query(APPROVE, {
                requestToken,
                approved: true,
            });

            const redirect = new URL(authorizeMcpClient.redirectUrl);
            expect(redirect.searchParams.get('code')).toBeTruthy();
            expect(redirect.searchParams.get('state')).toBe('state-abc');
        });

        it('records the grant against that customer and channel', async () => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { requestToken, client_id, code_verifier, redirectUri } = await startShopAuthorization();
            const { authorizeMcpClient } = await shopClient.query(APPROVE, {
                requestToken,
                approved: true,
            });
            const code = new URL(authorizeMcpClient.redirectUrl).searchParams.get('code') as string;

            const tokenResponse = await fetch(`${baseUrl()}/mcp/oauth/token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    code,
                    client_id,
                    redirect_uri: redirectUri,
                    code_verifier,
                    resource: `${ISSUER}/mcp/shop`,
                }),
            });
            const { access_token } = (await tokenResponse.json()) as { access_token: string };

            const connection = server.app.get(TransactionalConnection);
            const grant = await connection.rawConnection.getRepository(McpOauthGrant).findOne({
                where: { accessTokenHash: lookupHash(access_token) },
            });
            expect(grant?.userType).toBe('customer');
            expect(grant?.userId).toBeTruthy();
            expect(grant?.channelId).toBeTruthy();
        });

        it('allows denial with no signed-in customer', async () => {
            await shopClient.asAnonymousUser();
            const { requestToken } = await startShopAuthorization();

            const { authorizeMcpClient } = await shopClient.query(APPROVE, {
                requestToken,
                approved: false,
            });

            const redirect = new URL(authorizeMcpClient.redirectUrl);
            expect(redirect.searchParams.get('error')).toBe('access_denied');
        });

        it('refuses approval with no signed-in customer', async () => {
            await shopClient.asAnonymousUser();
            const { requestToken } = await startShopAuthorization();

            await expect(shopClient.query(APPROVE, { requestToken, approved: true })).rejects.toThrow(
                /signed-in customer/,
            );
        });

        it('refuses approval from an administrator', async () => {
            // The Shop API's own login mutation is customer-scoped — it inner-joins the
            // `customer` table, so a superadmin (Administrator-only, no Customer record) simply
            // cannot obtain a Shop API session through login at all. What this check guards
            // against is the same underlying user *also* holding an Administrator record, so it
            // is exercised directly here: a synthetic Shop API context authenticated as the
            // seeded superadmin's real user id, which does have one.
            const oauth = server.app.get(McpOauthService);
            const connection = server.app.get(TransactionalConnection);
            const requestContextService = server.app.get(RequestContextService);
            const adminCtx = await requestContextService.create({ apiType: 'admin' });
            const [administrator] = await connection
                .getRepository(adminCtx, Administrator)
                .find({ relations: ['user'], take: 1 });
            const { requestToken } = await startShopAuthorization();
            const ctx = new RequestContext({
                apiType: 'shop',
                channel: new Channel({ id: 1 }),
                session: {
                    token: 'mcp-test-session',
                    user: { id: administrator.user.id },
                } as any,
                // No Origin header is present, so the origin check passes, and this exercises
                // assertNotAnAdministrator in isolation from assertStorefrontConsentOrigin.
                req: { headers: { authorization: 'Bearer mcp-test' } } as any,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });

            await expect(oauth.approveCustomerRequest(ctx, requestToken, true)).rejects.toThrow(
                /administrator/,
            );
        });

        it('refuses a request token that has already been used', async () => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { requestToken } = await startShopAuthorization();
            await shopClient.query(APPROVE, { requestToken, approved: true });

            await expect(shopClient.query(APPROVE, { requestToken, approved: true })).rejects.toThrow(
                /invalid or expired/,
            );
        });

        // GET /mcp/oauth/authorize needs no credential, so anyone can start a flow for the
        // administrator resource and read the request token straight out of the redirect. A
        // signed-in customer must not be able to decide that request through the shop mutation
        // just because they hold a valid request token for it.
        it('refuses a signed-in customer approving a request started for the administrator resource', async () => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { request_token: requestToken } = await authorizeAdminToCodePreConsent();

            await expect(shopClient.query(APPROVE, { requestToken, approved: true })).rejects.toThrow(
                /invalid or expired/i,
            );
        });

        // The mirror case: an administrator must not be able to decide a request that was started
        // for the shop resource, even though the admin consent mutation has no other way of
        // knowing which toolset a given request token belongs to.
        it('refuses an administrator approving a request started for the shop resource', async () => {
            const { requestToken } = await startShopAuthorization();

            const body = await submitAdminConsent({
                baseUrl: baseUrl(),
                superAdminToken,
                requestToken,
                approved: true,
            });
            expect(body.data?.authorizeMcpClient).toBeUndefined();
            expect(body.errors?.[0]?.message).toMatch(/invalid or expired/i);
        });

        it('approves a signed-in customer request with no Origin header', async () => {
            // This is the server-rendered consent page: a Next.js or Remix action calling the
            // Shop API from Node, which attaches no `Origin` header at all — that absence is what
            // the check allows. `Authorization: Bearer` is unrelated to that decision; it is only
            // what signs the shopper in, exactly as any other authenticated request would use.
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const sessionToken = shopClient.getAuthToken();
            const { requestToken } = await startShopAuthorization();

            const response = await fetch(`${baseUrl()}/shop-api`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${sessionToken}`,
                },
                body: JSON.stringify({
                    query: `mutation { authorizeMcpClient(requestToken: "${requestToken}", approved: true) { redirectUrl } }`,
                }),
            });
            const body = (await response.json()) as any;
            expect(body.errors).toBeUndefined();
            expect(body.data.authorizeMcpClient.redirectUrl).toContain('code=');
        });

        it('refuses a request with a mismatched Origin header', async () => {
            // A browser attaches `Origin` to every cross-site POST and page code cannot suppress
            // it, so this is the shape an attacker's page actually arrives with. The plugin's test
            // server authenticates over `Authorization: Bearer` rather than a real signed session
            // cookie, so this simulates it the same way the equivalent admin-consent test does: a
            // synthetic context carrying a real customer's user id and a foreign Origin, with no
            // Authorization header (the origin check no longer looks for one either way).
            const oauth = server.app.get(McpOauthService);
            const connection = server.app.get(TransactionalConnection);
            const requestContextService = server.app.get(RequestContextService);
            const adminCtx = await requestContextService.create({ apiType: 'admin' });
            const [customer] = await connection
                .getRepository(adminCtx, Customer)
                .find({ relations: ['user'], take: 1 });
            if (!customer?.user) {
                throw new Error('Expected at least one seeded customer with a user');
            }
            const { requestToken } = await startShopAuthorization();
            const ctx = new RequestContext({
                apiType: 'shop',
                channel: new Channel({ id: 1 }),
                session: {
                    token: 'mcp-test-session',
                    user: { id: customer.user.id },
                } as any,
                req: { headers: { origin: 'https://attacker.example.com' } } as any,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });

            await expect(oauth.approveCustomerRequest(ctx, requestToken, true)).rejects.toThrow(
                /consent page/,
            );
        });
    });

    // --- helpers that stop before consent ---

    // Drives DCR + authorize for the admin resource and returns the request token, so a
    // test can exercise the admin consent mutation directly without approving yet.
    async function authorizeAdminToCodePreConsent() {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                client_name: `pre-consent-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            }),
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const code_verifier = 'a'.repeat(64);
        const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');
        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', code_challenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/admin`);
        const authorizeRes = await fetch(authorizeUrl, { redirect: 'manual' });
        const request_token = extractRequestToken(authorizeRes.headers.get('location'));
        return { client_id, request_token };
    }

    // Pulls the `request_token` out of a consent redirect Location header,
    // throwing a clear error if the redirect is missing or malformed.
    function extractRequestToken(location: string | null): string {
        if (!location) {
            throw new Error('Authorize did not redirect to consent');
        }
        const requestToken = new URL(location).searchParams.get('request_token');
        if (!requestToken) {
            throw new Error(`Consent redirect missing request_token: ${location}`);
        }
        return requestToken;
    }
});

describe('shop authorization with no storefrontConsentUrl configured', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [
            McpPlugin.init({
                oauth: { tokenSecret: TOKEN_SECRET },
                rateLimits: { oauthIp: false },
            }),
        ],
    });
    const { server: noConsentUrlServer } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        // Multiple test servers in this file share the McpPlugin class's static options field
        // (read at bootstrap), so this describe must reassert its own oauth config immediately
        // before booting its server.
        McpPlugin.init({ oauth: { tokenSecret: TOKEN_SECRET }, rateLimits: { oauthIp: false } });
        await noConsentUrlServer.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await noConsentUrlServer.destroy();
    });

    it('redirects the error to the client and writes no pending request', async () => {
        const redirectUri = 'https://example.com/cb';
        const registerResponse = await fetch(`${baseUrl()}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: 'no-consent-url', redirect_uris: [redirectUri] }),
        });
        const { client_id } = (await registerResponse.json()) as { client_id: string };

        const authorizeUrl = new URL(`${baseUrl()}/mcp/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', 'x'.repeat(43));
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
        authorizeUrl.searchParams.set('resource', `${ISSUER}/mcp/shop`);
        authorizeUrl.searchParams.set('state', 'state-xyz');

        const response = await fetch(authorizeUrl, { redirect: 'manual' });
        const location = new URL(response.headers.get('location') as string);

        expect(location.origin + location.pathname).toBe(redirectUri);
        expect(location.searchParams.get('error')).toBe('server_error');
        expect(location.searchParams.get('state')).toBe('state-xyz');
        // The message must not leak the setting name to a third-party client.
        expect(location.searchParams.get('error_description')).not.toContain('storefrontConsentUrl');

        const connection = noConsentUrlServer.app.get(TransactionalConnection);
        const pending = await connection.rawConnection.getRepository(McpAuthorizationRequest).count();
        expect(pending).toBe(0);
    });
});

describe('OAuth surface per-IP rate limit', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [
            McpPlugin.init({
                oauth: { tokenSecret: TOKEN_SECRET },
                rateLimits: { oauthIp: { rpm: 3 } },
            }),
        ],
    });
    const { server: rateLimitedServer } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    beforeAll(async () => {
        // Multiple test servers in this file share the McpPlugin class's static options field
        // (read at bootstrap), so this describe must reassert its own oauth config immediately
        // before booting its server.
        McpPlugin.init({
            oauth: { tokenSecret: TOKEN_SECRET },
            rateLimits: { oauthIp: { rpm: 3 } },
        });
        await rateLimitedServer.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await rateLimitedServer.destroy();
    });

    it('allows up to the configured rpm then returns 429 with Retry-After and the generic body', async () => {
        for (let i = 0; i < 3; i++) {
            const response = await fetch(`${baseUrl()}/.well-known/oauth-authorization-server`);
            expect(response.status).toBe(200);
        }

        const fourth = await fetch(`${baseUrl()}/.well-known/oauth-authorization-server`);
        expect(fourth.status).toBe(429);
        expect(fourth.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(await fourth.json()).toMatchObject({ error: 'rate_limit_exceeded' });
    });

    it('shares the bucket across different OAuth routes (a different endpoint also 429s)', async () => {
        // The bucket above is already exhausted for this IP — a different route on the same
        // controller must be refused too, pinning the one-shared-bucket design.
        const response = await fetch(`${baseUrl()}/.well-known/oauth-protected-resource/mcp/shop`);
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toMatch(/^\d+$/);
        expect(await response.json()).toMatchObject({ error: 'rate_limit_exceeded' });
    });
});
