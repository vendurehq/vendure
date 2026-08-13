import crypto from 'crypto';

import { AUTHORIZE_MCP_CLIENT } from '../../src/dashboard/queries';

// Reusable client that drives the real MCP OAuth flow over HTTP against a running
// test server, using the admin consent path. The superadmin bearer token (readily
// available from the test harness) stands in for the authenticated administrator,
// so no separate customer credentials are needed.
//
// Flow: register (DCR) -> authorize -> admin consent mutation -> token exchange.

export interface AuthorizationCodeFlowResult {
    /** The plaintext OAuth client_id returned by Dynamic Client Registration. */
    client_id: string;
    /** The registered redirect URI used throughout the flow. */
    redirect_uri: string;
    /** The resource (audience) the grant is scoped to, e.g. `${issuer}/mcp/admin`. */
    resource: string;
    /** The PKCE verifier; tests may re-use it to exchange the code themselves. */
    code_verifier: string;
    /** The PKCE challenge derived from the verifier. */
    code_challenge: string;
    /** The plaintext request token extracted from the consent redirect. */
    request_token: string;
    /** The plaintext authorization code extracted from the consent redirect. */
    code: string;
    /** The created access token (plaintext). */
    access_token: string;
    /** The created refresh token (plaintext). */
    refresh_token: string;
}

export interface SubmitAdminConsentOptions {
    /** Base URL of the running test server, e.g. `http://localhost:3260`. */
    baseUrl: string;
    /** The plaintext request token identifying the pending authorization request. */
    requestToken: string;
    /** The decision to record. */
    approved: boolean;
    /** Superadmin bearer token; omit to submit unauthenticated. */
    superAdminToken?: string;
}

export interface AdminConsentResponseBody {
    data?: { authorizeMcpClient?: { redirectUrl: string } };
    errors?: Array<{ message: string }>;
}

/**
 * Records an admin's consent decision through the Admin API's `authorizeMcpClient`
 * mutation — the same call the dashboard consent page makes — with the superadmin
 * session travelling as a bearer header. Returns the raw GraphQL response body so
 * tests can assert on errors as well as success.
 */
export async function submitAdminConsent(
    options: SubmitAdminConsentOptions,
): Promise<AdminConsentResponseBody> {
    const response = await fetch(`${options.baseUrl}/admin-api`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(options.superAdminToken ? { Authorization: `Bearer ${options.superAdminToken}` } : {}),
        },
        body: JSON.stringify({
            query: AUTHORIZE_MCP_CLIENT,
            variables: { requestToken: options.requestToken, approved: options.approved },
        }),
    });
    return (await response.json()) as AdminConsentResponseBody;
}

export interface RunAuthorizationCodeFlowOptions {
    /** Base URL of the running test server, e.g. `http://localhost:3260`. */
    baseUrl: string;
    /** OAuth issuer origin, e.g. `http://localhost:3000`. */
    issuer: string;
    /** Superadmin bearer token used to authenticate the admin-consent step. */
    superAdminToken: string;
    /** Human-readable client name for DCR. Defaults to a unique value per call. */
    clientName?: string;
    /** Registered redirect URI. Defaults to `https://example.com/cb`. */
    redirectUri?: string;
    /** Use this client_id as-is and skip Dynamic Client Registration (CIMD flows). */
    clientId?: string;
}

/**
 * Drives the full admin OAuth authorization-code flow and returns every value a
 * test might need to assert on or replay. Throws (via the assertions below) if any
 * step returns an unexpected status, so a broken flow surfaces immediately.
 */
export async function runAuthorizationCodeFlow(
    options: RunAuthorizationCodeFlowOptions,
): Promise<AuthorizationCodeFlowResult> {
    const {
        baseUrl,
        issuer,
        superAdminToken,
        clientName = `oauth-test-client-${Math.random().toString(36).slice(2)}`,
        redirectUri = 'https://example.com/cb',
    } = options;

    const resource = `${issuer}/mcp/admin`;

    // PKCE: a fixed-length verifier and its S256 challenge.
    const code_verifier = 'a'.repeat(64);
    const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');

    // 1. Obtain a client_id: either the caller supplies one (CIMD — the server resolves it
    // from the URL at the authorize step), or Dynamic Client Registration creates one.
    let client_id: string;
    if (options.clientId) {
        client_id = options.clientId;
    } else {
        const registerResponse = await fetch(`${baseUrl}/mcp/oauth/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri] }),
        });
        if (!registerResponse.ok) {
            throw new Error(`DCR failed: ${registerResponse.status} ${await registerResponse.text()}`);
        }
        ({ client_id } = (await registerResponse.json()) as { client_id: string });
    }

    // 2. Authorize: returns a 302 redirect to the consent page carrying the request token.
    const authorizeUrl = new URL(`${baseUrl}/mcp/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', code_challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('resource', resource);

    const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
    const consentLocation = authorizeResponse.headers.get('location');
    if (!consentLocation) {
        throw new Error(`Authorize did not redirect to consent (status ${authorizeResponse.status})`);
    }
    const request_token = new URL(consentLocation).searchParams.get('request_token');
    if (!request_token) {
        throw new Error(`Consent redirect missing request_token param: ${consentLocation}`);
    }

    // 3. Admin consent: the Admin API mutation, authenticated as superadmin via the bearer token.
    const consentBody = await submitAdminConsent({
        baseUrl,
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
        throw new Error(`Consent redirect missing code param: ${redirectUrl}`);
    }

    // 4. Token exchange: authorization code -> access + refresh tokens.
    const tokenResponse = await fetch(`${baseUrl}/mcp/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id,
            redirect_uri: redirectUri,
            code_verifier,
            resource,
        }),
    });
    if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
    }
    const { access_token, refresh_token } = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
    };

    return {
        client_id,
        redirect_uri: redirectUri,
        resource,
        code_verifier,
        code_challenge,
        request_token,
        code,
        access_token,
        refresh_token,
    };
}

export interface RunShopAuthorizationCodeFlowOptions {
    /** Base URL of the running test server, e.g. `http://localhost:3260`. */
    baseUrl: string;
    /** OAuth issuer origin, e.g. `http://localhost:3000`. */
    issuer: string;
    /** A real Vendure customer session token, used to approve storefront consent. */
    vendureAuthToken: string;
    /** Human-readable client name for DCR. Defaults to a unique value per call. */
    clientName?: string;
    /** Registered redirect URI. Defaults to `https://example.com/cb`. */
    redirectUri?: string;
    /**
     * Channel token to submit the consent under, sent as the `vendure-token` header. A real
     * consent page must send this on a multi-channel store: the mutation takes the channel from
     * the request, so omitting it binds the grant to the default channel and moves the shopper's
     * session there. Omit only when the default channel is what you want.
     */
    channelToken?: string;
}

/**
 * Drives the full storefront (shop) OAuth authorization-code flow and returns every
 * value a test might need. The shop path differs from the admin path only at the
 * consent step: instead of a superadmin calling the Admin API, the Shop API's
 * `authorizeMcpClient` mutation approves the request, with the customer's session
 * (`vendureAuthToken`) travelling as a bearer header.
 *
 * Flow: register (DCR) -> authorize (resource = shop) -> authorizeMcpClient mutation -> token exchange.
 */
export async function runShopAuthorizationCodeFlow(
    options: RunShopAuthorizationCodeFlowOptions,
): Promise<AuthorizationCodeFlowResult> {
    const {
        baseUrl,
        issuer,
        vendureAuthToken,
        clientName = `oauth-shop-test-client-${Math.random().toString(36).slice(2)}`,
        redirectUri = 'https://example.com/cb',
        channelToken,
    } = options;

    const resource = `${issuer}/mcp/shop`;

    const code_verifier = 'a'.repeat(64);
    const code_challenge = crypto.createHash('sha256').update(code_verifier).digest('base64url');

    // 1. Dynamic Client Registration.
    const registerResponse = await fetch(`${baseUrl}/mcp/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri] }),
    });
    if (!registerResponse.ok) {
        throw new Error(`DCR failed: ${registerResponse.status} ${await registerResponse.text()}`);
    }
    const { client_id } = (await registerResponse.json()) as { client_id: string };

    // 2. Authorize with the shop resource: the redirect points at the storefront consent URL.
    const authorizeUrl = new URL(`${baseUrl}/mcp/oauth/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', client_id);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('code_challenge', code_challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('resource', resource);

    const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
    const consentLocation = authorizeResponse.headers.get('location');
    if (!consentLocation) {
        throw new Error(`Authorize did not redirect to consent (status ${authorizeResponse.status})`);
    }
    const request_token = new URL(consentLocation).searchParams.get('request_token');
    if (!request_token) {
        throw new Error(`Consent redirect missing request_token param: ${consentLocation}`);
    }

    // 3. Storefront consent: the page submits through the Shop API, so the customer's session
    // travels as a header rather than in the body.
    const consentResponse = await fetch(`${baseUrl}/shop-api`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${vendureAuthToken}`,
            ...(channelToken ? { 'vendure-token': channelToken } : {}),
        },
        body: JSON.stringify({
            query: AUTHORIZE_MCP_CLIENT,
            variables: { requestToken: request_token, approved: true },
        }),
    });
    const consentBody = (await consentResponse.json()) as {
        data?: { authorizeMcpClient?: { redirectUrl: string } };
        errors?: Array<{ message: string }>;
    };
    if (!consentBody.data?.authorizeMcpClient) {
        throw new Error(`Storefront consent failed: ${consentBody.errors?.[0]?.message ?? 'unknown error'}`);
    }
    const { redirectUrl } = consentBody.data.authorizeMcpClient;
    const code = new URL(redirectUrl).searchParams.get('code');
    if (!code) {
        throw new Error(`Consent redirect missing code param: ${redirectUrl}`);
    }

    // 4. Token exchange: authorization code -> access + refresh tokens.
    const tokenResponse = await fetch(`${baseUrl}/mcp/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            client_id,
            redirect_uri: redirectUri,
            code_verifier,
            resource,
        }),
    });
    if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
    }
    const { access_token, refresh_token } = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
    };

    return {
        client_id,
        redirect_uri: redirectUri,
        resource,
        code_verifier,
        code_challenge,
        request_token,
        code,
        access_token,
        refresh_token,
    };
}
