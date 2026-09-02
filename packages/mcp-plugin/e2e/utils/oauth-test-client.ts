import crypto from 'crypto';

import { AUTHORIZE_MCP_CLIENT } from '../graphql/mcp-documents';

/** Everything an authorization-code flow has produced by the time it has a code in hand. */
export interface PendingAuthorizationCode {
    /** The plaintext OAuth client_id returned by Dynamic Client Registration. */
    client_id: string;
    /** The registered redirect URI used throughout the flow. */
    redirect_uri: string;
    /** The resource (audience) the grant is scoped to, e.g. `${issuer}/mcp/admin`. */
    resource: string;
    /** The PKCE verifier; tests may re-use it to exchange the code themselves. */
    code_verifier: string;
    /** The plaintext request token extracted from the consent redirect. */
    request_token: string;
    /** The plaintext authorization code extracted from the consent redirect. */
    code: string;
}

export interface AuthorizationCodeFlowResult extends PendingAuthorizationCode {
    /** The created access token (plaintext). */
    access_token: string;
    /** The created refresh token (plaintext). */
    refresh_token: string;
}

interface SubmitAdminConsentOptions {
    /** Base URL of the running test server, e.g. `http://localhost:3260`. */
    baseUrl: string;
    /** The plaintext request token identifying the pending authorization request. */
    requestToken: string;
    /** The decision to record. */
    approved: boolean;
    /** Superadmin bearer token; omit to submit unauthenticated. */
    superAdminToken?: string;
    /**
     * Channel token to submit the consent under, sent as the `vendure-token` header. The
     * dashboard always sends the channel its selector is on, and the grant is bound to that
     * channel. Omit only when the default channel is what you want.
     */
    channelToken?: string;
}

export interface ConsentResponseBody {
    data?: { authorizeMcpClient?: { redirectUrl: string } };
    errors?: Array<{ message: string }>;
}

/**
 * Records an admin's consent decision through the Admin API's `authorizeMcpClient`
 * mutation — the same call the dashboard consent page makes — with the superadmin
 * session travelling as a bearer header. Returns the raw GraphQL response body so
 * tests can assert on errors as well as success.
 */
export async function submitAdminConsent(options: SubmitAdminConsentOptions): Promise<ConsentResponseBody> {
    const response = await fetch(`${options.baseUrl}/admin-api`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(options.superAdminToken ? { Authorization: `Bearer ${options.superAdminToken}` } : {}),
            ...(options.channelToken ? { 'vendure-token': options.channelToken } : {}),
        },
        body: JSON.stringify({
            query: AUTHORIZE_MCP_CLIENT,
            variables: { requestToken: options.requestToken, approved: options.approved },
        }),
    });
    return (await response.json()) as ConsentResponseBody;
}

/**
 * Sends a Dynamic Client Registration request with exactly the given body and returns the raw
 * response, so a test can assert on a refusal as readily as on success.
 */
export function registerClient(options: {
    baseUrl: string;
    body: Record<string, unknown>;
}): Promise<Response> {
    return fetch(`${options.baseUrl}/mcp/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options.body),
    });
}

/**
 * Requests authorization with exactly the given query parameters and does not follow the redirect,
 * so a test can read the consent Location header or assert on a refusal.
 */
export function authorize(options: { baseUrl: string; params: Record<string, string> }): Promise<Response> {
    const url = new URL(`${options.baseUrl}/mcp/oauth/authorize`);
    for (const [name, value] of Object.entries(options.params)) {
        url.searchParams.set(name, value);
    }
    return fetch(url, { redirect: 'manual' });
}

/** Sends a token request with exactly the given body and returns the raw response. */
export function exchangeCode(options: { baseUrl: string; body: Record<string, unknown> }): Promise<Response> {
    return fetch(`${options.baseUrl}/mcp/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options.body),
    });
}

/** Reads the request token out of the consent redirect an authorize response carries. */
export function extractRequestToken(authorizeResponse: Response): string {
    const consentLocation = authorizeResponse.headers.get('location');
    if (!consentLocation) {
        throw new Error(`Authorize did not redirect to consent (status ${authorizeResponse.status})`);
    }
    const requestToken = new URL(consentLocation).searchParams.get('request_token');
    if (!requestToken) {
        throw new Error(`Consent redirect missing request_token param: ${consentLocation}`);
    }
    return requestToken;
}

/**
 * A syntactically valid `code_challenge` for tests that never exchange the code, so the value
 * itself never matters. 43 characters is the shortest PKCE allows (RFC 7636 4.2).
 */
export const PLACEHOLDER_CODE_CHALLENGE = 'a'.repeat(43);

/** A fixed-length PKCE verifier and its matching S256 challenge. */
export function pkcePair(): { code_verifier: string; code_challenge: string } {
    const code_verifier = 'a'.repeat(64);
    return {
        code_verifier,
        code_challenge: crypto.createHash('sha256').update(code_verifier).digest('base64url'),
    };
}

interface DriveAuthorizationCodeFlowOptions {
    baseUrl: string;
    resource: string;
    clientName: string;
    redirectUri: string;
    clientId?: string;
    /** Records the consent decision and returns the redirect URL carrying the code. */
    approve: (requestToken: string) => Promise<string>;
}

/**
 * Runs the three steps that lead up to a usable authorization code (obtain a client_id,
 * authorize, consent, the last delegated to `approve` because it differs per surface) and
 * stops there.
 * Kept separate from the exchange so a test can do something to the store in between, such as
 * deleting the user who approved. Throws if any step returns an unexpected status, so a broken
 * flow surfaces immediately.
 */
async function driveToAuthorizationCode(
    options: DriveAuthorizationCodeFlowOptions,
): Promise<PendingAuthorizationCode> {
    const { baseUrl, resource, clientName, redirectUri, approve } = options;

    const { code_verifier, code_challenge } = pkcePair();

    // 1. Obtain a client_id: either the caller supplies one (CIMD — the server resolves it
    // from the URL at the authorize step), or Dynamic Client Registration creates one.
    let client_id: string;
    if (options.clientId) {
        client_id = options.clientId;
    } else {
        const registerResponse = await registerClient({
            baseUrl,
            body: { client_name: clientName, redirect_uris: [redirectUri] },
        });
        if (!registerResponse.ok) {
            throw new Error(`DCR failed: ${registerResponse.status} ${await registerResponse.text()}`);
        }
        ({ client_id } = (await registerResponse.json()) as { client_id: string });
    }

    // 2. Authorize: returns a 302 redirect to the consent page carrying the request token.
    const authorizeResponse = await authorize({
        baseUrl,
        params: {
            response_type: 'code',
            client_id,
            redirect_uri: redirectUri,
            code_challenge,
            code_challenge_method: 'S256',
            resource,
        },
    });
    const request_token = extractRequestToken(authorizeResponse);

    // 3. Consent, then read the code out of the redirect it returns.
    const redirectUrl = await approve(request_token);
    const code = new URL(redirectUrl).searchParams.get('code');
    if (!code) {
        throw new Error(`Consent redirect missing code param: ${redirectUrl}`);
    }

    return {
        client_id,
        redirect_uri: redirectUri,
        resource,
        code_verifier,
        request_token,
        code,
    };
}

/** Redeems the code a flow has just produced, and adds the resulting token pair to it. */
async function exchangePendingCode(
    baseUrl: string,
    pending: PendingAuthorizationCode,
): Promise<AuthorizationCodeFlowResult> {
    const tokenResponse = await exchangeCode({
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
    if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
    }
    const { access_token, refresh_token } = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token: string;
    };
    return { ...pending, access_token, refresh_token };
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
    /** Channel token to approve under; the grant is bound to that channel. Defaults to the default channel. */
    channelToken?: string;
}

/**
 * Drives the admin OAuth flow as far as an unredeemed authorization code. Use this when the
 * test needs to act between consent and the token exchange; call `exchangeCode` yourself
 * afterwards, or use {@link runAuthorizationCodeFlow} when nothing has to happen in between.
 */
export function runAuthorizationCodeFlowToCode(
    options: RunAuthorizationCodeFlowOptions,
): Promise<PendingAuthorizationCode> {
    return driveToAuthorizationCode(adminFlowOptions(options));
}

/**
 * Drives the full admin OAuth authorization-code flow and returns every value a
 * test might need to assert on or replay. Throws if any step returns an unexpected
 * status, so a broken flow surfaces immediately.
 */
export async function runAuthorizationCodeFlow(
    options: RunAuthorizationCodeFlowOptions,
): Promise<AuthorizationCodeFlowResult> {
    const pending = await driveToAuthorizationCode(adminFlowOptions(options));
    return exchangePendingCode(options.baseUrl, pending);
}

/** Turns the admin-flow options into the surface-agnostic ones the driver takes. */
function adminFlowOptions(options: RunAuthorizationCodeFlowOptions): DriveAuthorizationCodeFlowOptions {
    const {
        baseUrl,
        issuer,
        superAdminToken,
        clientName = `oauth-test-client-${Math.random().toString(36).slice(2)}`,
        redirectUri = 'https://example.com/cb',
        clientId,
        channelToken,
    } = options;

    return {
        baseUrl,
        resource: `${issuer}/mcp/admin`,
        clientName,
        redirectUri,
        clientId,
        approve: async requestToken => {
            const consentBody = await submitAdminConsent({
                baseUrl,
                superAdminToken,
                channelToken,
                requestToken,
                approved: true,
            });
            if (!consentBody.data?.authorizeMcpClient) {
                throw new Error(
                    `Admin consent failed: ${consentBody.errors?.[0]?.message ?? 'unknown error'}`,
                );
            }
            return consentBody.data.authorizeMcpClient.redirectUrl;
        },
    };
}

export interface RunShopAuthorizationCodeFlowOptions {
    /** Base URL of the running test server, e.g. `http://localhost:3260`. */
    baseUrl: string;
    /** OAuth issuer origin, e.g. `http://localhost:3000`. */
    issuer: string;
    /** A real Vendure customer session token, used to approve storefront consent. */
    vendureAuthToken: string;
    /**
     * Channel token to submit the consent under, sent as the `vendure-token` header. A real
     * consent page must send this on a multi-channel store: the mutation takes the channel from
     * the request, so omitting it binds the grant to the default channel and moves the shopper's
     * session there. Omit only when the default channel is what you want.
     */
    channelToken?: string;
}

interface SubmitShopConsentOptions {
    baseUrl: string;
    requestToken: string;
    vendureAuthToken: string;
    channelToken?: string;
}

/**
 * Approves a pending authorization request through the Shop API's `authorizeMcpClient`
 * mutation — the same call the storefront consent page makes — with the customer's session
 * travelling as a bearer header. Returns the raw GraphQL response body.
 */
export async function submitShopConsent(options: SubmitShopConsentOptions): Promise<ConsentResponseBody> {
    const response = await fetch(`${options.baseUrl}/shop-api`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${options.vendureAuthToken}`,
            ...(options.channelToken ? { 'vendure-token': options.channelToken } : {}),
        },
        body: JSON.stringify({
            query: AUTHORIZE_MCP_CLIENT,
            variables: { requestToken: options.requestToken, approved: true },
        }),
    });
    return (await response.json()) as ConsentResponseBody;
}

/**
 * Drives the full storefront (shop) OAuth authorization-code flow and returns every
 * value a test might need. The shop path differs from the admin path only at the
 * consent step: instead of a superadmin calling the Admin API, the Shop API's
 * `authorizeMcpClient` mutation approves the request, with the customer's session
 * (`vendureAuthToken`) travelling as a bearer header.
 */
export async function runShopAuthorizationCodeFlow(
    options: RunShopAuthorizationCodeFlowOptions,
): Promise<AuthorizationCodeFlowResult> {
    const { baseUrl, issuer, vendureAuthToken, channelToken } = options;
    const clientName = `oauth-shop-test-client-${Math.random().toString(36).slice(2)}`;
    const redirectUri = 'https://example.com/cb';

    const pending = await driveToAuthorizationCode({
        baseUrl,
        resource: `${issuer}/mcp/shop`,
        clientName,
        redirectUri,
        approve: async requestToken => {
            const consentBody = await submitShopConsent({
                baseUrl,
                vendureAuthToken,
                channelToken,
                requestToken,
            });
            if (!consentBody.data?.authorizeMcpClient) {
                throw new Error(
                    `Storefront consent failed: ${consentBody.errors?.[0]?.message ?? 'unknown error'}`,
                );
            }
            return consentBody.data.authorizeMcpClient.redirectUrl;
        },
    });
    return exchangePendingCode(baseUrl, pending);
}
