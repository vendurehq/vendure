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
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { mcpServerPermission } from '../src/constants';
import { McpAuthorizationCode } from '../src/entities/mcp-authorization-code.entity';
import { McpAuthorizationRequest } from '../src/entities/mcp-authorization-request.entity';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpOauthService } from '../src/oauth/oauth.service';
import { deriveHashKey, hashLookupToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { AUTHORIZE_MCP_CLIENT } from './graphql/mcp-documents';
import { initializeParams, postMcp, rpc } from './utils/mcp-http-client';
import {
    authorize,
    exchangeCode,
    extractRequestToken,
    pkcePair,
    PLACEHOLDER_CODE_CHALLENGE,
    registerClient,
    runAuthorizationCodeFlow,
    runShopAuthorizationCodeFlow,
    submitAdminConsent,
    submitShopConsent,
} from './utils/oauth-test-client';
import { initTestServer } from './utils/test-server';

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

    // Used to find stored rows from their plaintext token, for database-level tampering.
    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);

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
        await initTestServer(server);
        // Superadmin bearer approves admin consent; it stands in for an authenticated admin.
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();

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
    const runAdminFlow = () =>
        runAuthorizationCodeFlow({ baseUrl: baseUrl(), issuer: ISSUER, superAdminToken });

    /** Runs the full shop authorization-code flow with the real customer session token. */
    const runShopFlow = () =>
        runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: customerAuthToken,
        });

    const authorizeAdminToCode = async (overrides?: { redirectUri?: string; resource?: string }) => {
        const redirectUri = overrides?.redirectUri ?? 'https://example.com/cb';
        const { code_verifier, code_challenge } = pkcePair();
        const resource = overrides?.resource ?? `${ISSUER}/mcp/admin`;

        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `edge-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const authorizeRes = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge,
                code_challenge_method: 'S256',
                resource,
            },
        });
        const request_token = extractRequestToken(authorizeRes);

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

    it('rejects token exchange with an invalid PKCE verifier', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCode();

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: flow.redirect_uri,
                code_verifier: 'b'.repeat(64),
                resource: flow.resource,
            }),
        ).rejects.toThrow(/PKCE/i);
    });

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

    it('rejects authorize when redirect_uri is not registered for the client', async () => {
        const redirectUri = 'https://example.com/registered';
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `unregistered-redirect-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const { code_challenge } = pkcePair();
        const res = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: 'https://evil.example.com/cb',
                code_challenge,
                code_challenge_method: 'S256',
                resource: `${ISSUER}/mcp/admin`,
            },
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/redirect_uri is not registered/i);
    });

    it('rejects token exchange when redirect_uri does not match the authorization code', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await authorizeAdminToCode({ redirectUri: 'https://example.com/code-uri' });

        await expect(
            oauth.exchangeToken({
                grant_type: 'authorization_code',
                code: flow.code,
                client_id: flow.client_id,
                redirect_uri: 'https://example.com/different-uri',
                code_verifier: flow.code_verifier,
                resource: flow.resource,
            }),
        ).rejects.toThrow(/does not match client or redirect_uri/i);
    });

    it('rejects authorize when the resource parameter is missing', async () => {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `no-resource-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const { code_challenge } = pkcePair();
        const res = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge,
                code_challenge_method: 'S256',
                // Deliberately omit the `resource` parameter.
            },
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toMatch(/resource is required/i);
    });

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
        ).rejects.toThrow('code, client_id, redirect_uri, code_verifier and resource are required');
    });

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

    it('rejects an expired authorization code', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const flow = await authorizeAdminToCode();

        // The stored code is the lookup-hash of the plaintext.
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

    it('rejects authorize with a state longer than 255 characters', async () => {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `long-state-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const longState = 'x'.repeat(300);
        const { code_challenge } = pkcePair();
        const res = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge,
                code_challenge_method: 'S256',
                resource: `${ISSUER}/mcp/admin`,
                state: longState,
            },
        });
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
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `bad-challenge-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const res = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256',
                resource: `${ISSUER}/mcp/admin`,
            },
        });
        expect(res.status).toBe(302);
        const location = new URL(res.headers.get('location') as string);
        expect(location.searchParams.get('error')).toBe('invalid_request');
        expect(location.searchParams.get('error_description')).toMatch(/code_challenge/i);
    });

    it('rejects DCR registration with a redirect_uri longer than 255 characters', async () => {
        const longRedirectUri = `https://example.com/${'x'.repeat(300)}`;
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `long-redirect-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [longRedirectUri],
            },
        });
        expect(registerRes.status).toBe(400);
    });

    it('drops an over-long client_uri and a non-https logo_uri instead of failing registration', async () => {
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `bad-display-fields-${Math.random().toString(36).slice(2)}`,
                redirect_uris: ['https://example.com/cb'],
                client_uri: `https://example.com/${'x'.repeat(300)}`,
                logo_uri: 'javascript:alert(1)',
            },
        });
        expect(registerRes.status).toBe(201);
        const body = (await registerRes.json()) as Record<string, unknown>;
        expect(body.client_uri).toBeUndefined();
        expect(body.logo_uri).toBeUndefined();
    });

    // DCR only advertises "none" as a supported token_endpoint_auth_method; any other value
    // is refused rather than stored unvalidated.
    it('rejects DCR registration with an unsupported token_endpoint_auth_method', async () => {
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `bad-auth-method-${Math.random().toString(36).slice(2)}`,
                redirect_uris: ['https://example.com/cb'],
                token_endpoint_auth_method: 'client_secret_basic',
            },
        });
        expect(registerRes.status).toBe(400);
    });

    // DCR advertises exactly two grant types; asking for any other is refused at registration
    // rather than echoed back as granted and rejected later at the token endpoint.
    it('rejects DCR registration with an unsupported grant type', async () => {
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `bad-grant-types-${Math.random().toString(36).slice(2)}`,
                redirect_uris: ['https://example.com/cb'],
                grant_types: ['authorization_code', 'client_credentials'],
            },
        });
        expect(registerRes.status).toBe(400);
    });

    // revoke() is a soft-revoke: the grant row survives (so McpToolCallLog audit links are
    // preserved) with revokedAt set, and the token is rejected at the resource afterwards.
    it('soft-revokes the grant: keeps the row with revokedAt set and rejects the token', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });
        const flow = await runAdminFlow();

        const ok = await oauth.authenticateBearerToken(flow.access_token, 'admin');
        expect(ok.ctx.apiType).toBe('admin');

        await oauth.revoke(flow.access_token);

        const grant = await connection
            .getRepository(ctx, McpOauthGrant)
            .findOne({ where: { accessTokenHash: lookupHash(flow.access_token) } });
        expect(grant).toBeTruthy();
        expect(grant?.revokedAt).toBeTruthy();

        await expect(oauth.authenticateBearerToken(flow.access_token, 'admin')).rejects.toThrow(
            /invalid or expired/i,
        );
    });

    it('rejects an access token whose stored resource has been tampered with', async () => {
        const oauth = server.app.get(McpOauthService);
        const connection = server.app.get(TransactionalConnection);
        const requestContextService = server.app.get(RequestContextService);
        const ctx = await requestContextService.create({ apiType: 'admin' });

        const flow = await runAdminFlow();

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

    // A token an administrator approved works only on the admin endpoint. The grant records which
    // kind of actor approved it, and this gate compares that record against the endpoint.
    //
    // Both directions are tested because the gate is written as one condition per direction, so a
    // mistake in either half is invisible to a test of the other. Each asserts the message as well
    // as the status: three separate checks in `authenticateBearerToken` answer 401, so a
    // status-only assertion cannot say which one refused the call.
    it('rejects an admin access token sent to the shop endpoint', async () => {
        const flow = await runAdminFlow();

        const res = await postMcp(baseUrl(), 'shop', rpc('initialize', initializeParams()), {
            token: flow.access_token,
        });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Access token does not allow this MCP endpoint');
    });

    // The dangerous direction: a shopper's token must never reach the admin tool set. A mistake
    // here hands a customer every administrator tool.
    it('rejects a customer access token sent to the admin endpoint', async () => {
        const flow = await runShopFlow();

        const res = await postMcp(baseUrl(), 'admin', rpc('initialize', initializeParams()), {
            token: flow.access_token,
        });
        expect(res.status).toBe(401);
        expect(res.body.message).toBe('Access token does not allow this MCP endpoint');
    });

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

    it('issues a shop token via the full storefront flow and authenticates the customer', async () => {
        const oauth = server.app.get(McpOauthService);
        const flow = await runShopFlow();
        expect(flow.access_token).toBeTruthy();
        expect(flow.refresh_token).toBeTruthy();

        const authenticated = await oauth.authenticateBearerToken(flow.access_token, 'shop');
        expect(authenticated.ctx.apiType).toBe('shop');
        expect(authenticated.grant.actorType).toBe('customer');
        expect(authenticated.ctx.activeUserId).toBe(authenticated.grant.actorId);
        expect(authenticated.grant.actorId).toBeTruthy();
    });

    describe('authorizeMcpClient mutation', () => {
        const APPROVE = gql(AUTHORIZE_MCP_CLIENT);

        /**
         * Starts an authorization for the shop resource and returns the request token the
         * consent page would receive, plus the client id and PKCE verifier needed to finish.
         */
        async function startShopAuthorization(redirectUri = 'https://example.com/cb') {
            const { code_verifier, code_challenge } = pkcePair();
            const registerResponse = await registerClient({
                baseUrl: baseUrl(),
                body: {
                    client_name: `approve-test-${Math.random().toString(36).slice(2)}`,
                    redirect_uris: [redirectUri],
                },
            });
            const { client_id } = (await registerResponse.json()) as { client_id: string };

            const authorizeResponse = await authorize({
                baseUrl: baseUrl(),
                params: {
                    response_type: 'code',
                    client_id,
                    redirect_uri: redirectUri,
                    code_challenge,
                    code_challenge_method: 'S256',
                    resource: `${ISSUER}/mcp/shop`,
                    state: 'state-abc',
                },
            });
            const requestToken = extractRequestToken(authorizeResponse);
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

            const tokenResponse = await exchangeCode({
                baseUrl: baseUrl(),
                body: {
                    grant_type: 'authorization_code',
                    code,
                    client_id,
                    redirect_uri: redirectUri,
                    code_verifier,
                    resource: `${ISSUER}/mcp/shop`,
                },
            });
            const { access_token } = (await tokenResponse.json()) as { access_token: string };

            const connection = server.app.get(TransactionalConnection);
            const grant = await connection.rawConnection.getRepository(McpOauthGrant).findOne({
                where: { accessTokenHash: lookupHash(access_token) },
            });
            expect(grant?.actorType).toBe('customer');
            expect(grant?.actorId).toBeTruthy();
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

            const body = await submitShopConsent({
                baseUrl: baseUrl(),
                requestToken,
                vendureAuthToken: sessionToken,
            });
            expect(body.errors).toBeUndefined();
            expect(body.data?.authorizeMcpClient?.redirectUrl).toContain('code=');
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

    async function authorizeAdminToCodePreConsent() {
        const redirectUri = 'https://example.com/cb';
        const registerRes = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `pre-consent-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerRes.json()) as { client_id: string };

        const { code_challenge } = pkcePair();
        const authorizeRes = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge,
                code_challenge_method: 'S256',
                resource: `${ISSUER}/mcp/admin`,
            },
        });
        const request_token = extractRequestToken(authorizeRes);
        return { client_id, request_token };
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
        await initTestServer(noConsentUrlServer);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await noConsentUrlServer.destroy();
    });

    it('redirects the error to the client and writes no pending request', async () => {
        const redirectUri = 'https://example.com/cb';
        const registerResponse = await registerClient({
            baseUrl: baseUrl(),
            body: { client_name: 'no-consent-url', redirect_uris: [redirectUri] },
        });
        const { client_id } = (await registerResponse.json()) as { client_id: string };

        const response = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge: PLACEHOLDER_CODE_CHALLENGE,
                code_challenge_method: 'S256',
                resource: `${ISSUER}/mcp/shop`,
                state: 'state-xyz',
            },
        });
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
        await initTestServer(rateLimitedServer);
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

// Every configurable OAuth lifetime, plus the admin consent path, set to a value nothing else in
// the plugin would produce and then checked against what the flow actually wrote.
//
// The lifetimes' *behaviour* is covered elsewhere by backdating rows, so expiry works. What is
// unproven without these tests is that the option is wired to it: a field read from the wrong place,
// or a rename that left the default in use, would pass every other test in this repository. That is
// why each test asserts the exact stored instant rather than merely that some expiry exists — the
// default values (900s, 2592000s, 60s, 600s) all satisfy a loose assertion just as happily.
describe('OAuth lifetime and consent-path options', () => {
    const ACCESS_TOKEN_TTL_SECONDS = 137;
    const REFRESH_TOKEN_TTL_SECONDS = 4321;
    const AUTHORIZATION_CODE_TTL_SECONDS = 23;
    const AUTHORIZATION_REQUEST_TTL_SECONDS = 271;
    const ADMIN_CONSENT_PATH = '/custom/mcp/consent';
    const options: McpPluginOptions = {
        oauth: {
            tokenSecret: TOKEN_SECRET,
            accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
            refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
            authorizationCodeTtlSeconds: AUTHORIZATION_CODE_TTL_SECONDS,
            authorizationRequestTtlSeconds: AUTHORIZATION_REQUEST_TTL_SECONDS,
            adminConsentPath: ADMIN_CONSENT_PATH,
        },
        rateLimits: { oauthIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);

    let superAdminToken: string;
    let connection: TransactionalConnection;
    let adminCtx: RequestContext;

    beforeAll(async () => {
        // Multiple test servers in this file share the McpPlugin class's static options field
        // (read at bootstrap), so this describe must reassert its own config immediately before
        // booting its server.
        McpPlugin.init(options);
        await initTestServer(server);
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
        connection = server.app.get(TransactionalConnection);
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    /** Runs `work`, and reports the wall-clock window it ran in so an expiry can be bounded by it. */
    async function timed<T>(work: () => Promise<T>): Promise<{ value: T; from: number; to: number }> {
        const from = Date.now();
        const value = await work();
        return { value, from, to: Date.now() };
    }

    /**
     * Asserts a stored expiry is exactly `ttlSeconds` after the moment the row was written. The row
     * was written somewhere inside the timed window, so the expiry must fall inside that window
     * shifted forward by the lifetime. One second of slack at the lower end covers a stored
     * timestamp truncated to whole seconds.
     */
    function expectExpiry(expiresAt: Date, ttlSeconds: number, window: { from: number; to: number }): void {
        expect(expiresAt.getTime()).toBeGreaterThanOrEqual(window.from + ttlSeconds * 1000 - 1000);
        expect(expiresAt.getTime()).toBeLessThanOrEqual(window.to + ttlSeconds * 1000);
    }

    /** Registers a client and authorizes, stopping at the consent redirect. */
    async function authorizeToConsent(): Promise<{ response: Response; requestToken: string }> {
        const redirectUri = 'https://example.com/cb';
        const registerResponse = await registerClient({
            baseUrl: baseUrl(),
            body: {
                client_name: `lifetime-client-${Math.random().toString(36).slice(2)}`,
                redirect_uris: [redirectUri],
            },
        });
        const { client_id } = (await registerResponse.json()) as { client_id: string };
        const response = await authorize({
            baseUrl: baseUrl(),
            params: {
                response_type: 'code',
                client_id,
                redirect_uri: redirectUri,
                code_challenge: PLACEHOLDER_CODE_CHALLENGE,
                code_challenge_method: 'S256',
                resource: `${ISSUER}/mcp/admin`,
            },
        });
        return { response, requestToken: extractRequestToken(response) };
    }

    it('accessTokenTtlSeconds sets the grant access-token expiry and the token response expires_in', async () => {
        const flow = await timed(() =>
            runAuthorizationCodeFlow({ baseUrl: baseUrl(), issuer: ISSUER, superAdminToken }),
        );

        const grant = await connection
            .getRepository(adminCtx, McpOauthGrant)
            .findOneOrFail({ where: { accessTokenHash: lookupHash(flow.value.access_token) } });
        expectExpiry(grant.accessTokenExpiresAt, ACCESS_TOKEN_TTL_SECONDS, flow);

        // The same number has to reach the wire: expires_in is what tells a client when to refresh.
        const form = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: flow.value.refresh_token,
            client_id: flow.value.client_id,
            resource: flow.value.resource,
        });
        const refreshed = await fetch(`${baseUrl()}/mcp/oauth/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form.toString(),
        });
        expect(refreshed.status).toBe(200);
        expect(((await refreshed.json()) as { expires_in: number }).expires_in).toBe(
            ACCESS_TOKEN_TTL_SECONDS,
        );
    });

    it("refreshTokenTtlSeconds sets the grant's own lifetime", async () => {
        const flow = await timed(() =>
            runAuthorizationCodeFlow({ baseUrl: baseUrl(), issuer: ISSUER, superAdminToken }),
        );

        const grant = await connection
            .getRepository(adminCtx, McpOauthGrant)
            .findOneOrFail({ where: { accessTokenHash: lookupHash(flow.value.access_token) } });
        // `expiresAt` is the grant's lifetime, which the refresh token's validity rides on; it is a
        // different column from the access-token expiry asserted above, and a much larger number.
        expectExpiry(grant.expiresAt, REFRESH_TOKEN_TTL_SECONDS, flow);
    });

    it('authorizationRequestTtlSeconds sets the pending consent request expiry', async () => {
        const authorized = await timed(() => authorizeToConsent());

        const request = await connection
            .getRepository(adminCtx, McpAuthorizationRequest)
            .findOneOrFail({ where: { requestToken: lookupHash(authorized.value.requestToken) } });
        expectExpiry(request.expiresAt, AUTHORIZATION_REQUEST_TTL_SECONDS, authorized);
    });

    it('authorizationCodeTtlSeconds sets the issued code expiry', async () => {
        const { requestToken } = await authorizeToConsent();

        // The code row is written when consent is recorded, so only that call is timed.
        const consented = await timed(() =>
            submitAdminConsent({ baseUrl: baseUrl(), superAdminToken, requestToken, approved: true }),
        );
        const redirectUrl = consented.value.data?.authorizeMcpClient?.redirectUrl;
        if (!redirectUrl) {
            throw new Error(`Consent failed: ${JSON.stringify(consented.value.errors)}`);
        }
        const code = new URL(redirectUrl).searchParams.get('code') as string;

        const codeRow = await connection
            .getRepository(adminCtx, McpAuthorizationCode)
            .findOneOrFail({ where: { code: lookupHash(code) } });
        expectExpiry(codeRow.expiresAt, AUTHORIZATION_CODE_TTL_SECONDS, consented);
    });

    it('adminConsentPath is where the authorize step sends the administrator', async () => {
        const { response } = await authorizeToConsent();

        expect(response.status).toBe(302);
        const location = new URL(response.headers.get('location') as string);
        expect(location.pathname).toBe(ADMIN_CONSENT_PATH);
        expect(location.origin).toBe(baseUrl());
        expect(location.searchParams.get('request_token')).toBeTruthy();
    });
});
