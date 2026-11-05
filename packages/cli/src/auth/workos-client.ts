import { setTimeout as sleep } from 'node:timers/promises';

import {
    ReauthenticationRequiredError,
    SessionRefreshUnavailableError,
    SessionRejectedError,
} from './auth-errors';
import { AuthOptions } from './auth-options';
import { AuthUser } from './auth-store';

export const WORKOS_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The WorkOS application a Vendure Console accepts tokens from, as Console
 * publishes it. The CLI never chooses either value itself.
 */
export interface WorkosClient {
    clientId: string;
    /** The WorkOS API host, e.g. `api.workos.com`. */
    apiHostname: string;
}

/** The device authorization WorkOS issued. https://workos.com/docs/reference/authkit/cli-auth */
export interface DeviceAuthorization {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    /** Seconds. */
    expiresIn: number;
    /** Seconds. */
    interval: number;
}

/** What WorkOS returns from the device code and refresh token grants. */
export interface WorkosAuthentication {
    accessToken: string;
    refreshToken: string;
    user: AuthUser;
    /** The organization the session is scoped to, when WorkOS reports one. */
    organizationId: string | null;
}

/** Test seam for the poll interval. */
export interface PollOptions extends AuthOptions {
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * WorkOS error codes that mean the session needs a new interactive sign-in
 * rather than a retry: an organization enforces SSO or MFA, or the user must
 * pick an organization. WorkOS reports some in `error` and some in `code`.
 */
const REAUTHENTICATION_CODES = new Set([
    'sso_required',
    'organization_authentication_methods_required',
    'mfa_enrollment',
    'mfa_challenge',
    'email_verification_required',
    'organization_selection_required',
]);

export async function startDeviceAuthorization(
    client: WorkosClient,
    options: AuthOptions = {},
): Promise<DeviceAuthorization> {
    const response = await workosRequest(
        client,
        '/user_management/authorize/device',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ client_id: client.clientId }).toString(),
        },
        options,
    );
    if (!response.ok) {
        const code = await readErrorCode(response);
        throw new Error(`Could not start the login: WorkOS answered ${describeFailure(response, code)}.`);
    }
    const body: unknown = await response.json();
    if (
        !isRecord(body) ||
        !nonEmpty(body.device_code) ||
        !nonEmpty(body.user_code) ||
        !isHttpsUrl(body.verification_uri) ||
        // Handed to the system browser opener, so it must be a web URL.
        !isHttpsUrl(body.verification_uri_complete) ||
        !positiveNumber(body.expires_in)
    ) {
        throw new Error('WorkOS returned a malformed device authorization.');
    }
    return {
        deviceCode: body.device_code,
        userCode: body.user_code,
        verificationUri: body.verification_uri,
        verificationUriComplete: body.verification_uri_complete,
        expiresIn: body.expires_in,
        interval: positiveNumber(body.interval) ? body.interval : 5,
    };
}

/**
 * Polls until the user approves the device in the browser, following the
 * RFC 8628 poll protocol: `authorization_pending` waits, `slow_down` adds five
 * seconds to the interval, anything else ends the login.
 */
export async function pollDeviceAuthorization(
    client: WorkosClient,
    device: DeviceAuthorization,
    options: PollOptions = {},
): Promise<WorkosAuthentication> {
    const now = options.now ?? Date.now;
    const wait = options.sleep ?? ((ms, signal) => sleep(ms, undefined, { signal }));
    const deadline = now() + device.expiresIn * 1000;
    let interval = device.interval;
    while (now() < deadline) {
        await wait(interval * 1000, options.signal);
        const response = await workosRequest(
            client,
            '/user_management/authenticate',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    device_code: device.deviceCode,
                    client_id: client.clientId,
                }),
            },
            options,
        );
        if (response.ok) {
            return parseAuthentication(await response.json());
        }
        const code = await readErrorCode(response);
        if (code === 'authorization_pending') {
            continue;
        }
        if (code === 'slow_down') {
            interval += 5;
            continue;
        }
        if (code === 'access_denied') {
            throw new Error('The login was denied in the browser.');
        }
        if (code === 'expired_token') {
            break;
        }
        throw new Error(`The login failed: WorkOS answered ${describeFailure(response, code)}.`);
    }
    throw new Error('The login code expired before it was approved. Run the login again.');
}

/**
 * Spends a refresh token. Pass `organizationId` to scope the new access token to
 * that WorkOS organization: WorkOS bakes the user's role and permissions in that
 * organization into the token's claims at issue time.
 *
 * `invalid_grant` means the token is dead. The codes in
 * {@link REAUTHENTICATION_CODES} mean a new sign-in is needed. Anything else is
 * reported as possibly transient, so a wrong guess costs the user a retry
 * rather than their login.
 */
export async function exchangeRefreshToken(
    client: WorkosClient,
    refreshToken: string,
    organizationId: string | null,
    options: AuthOptions = {},
): Promise<WorkosAuthentication> {
    let response: Response;
    try {
        response = await workosRequest(
            client,
            '/user_management/authenticate',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    client_id: client.clientId,
                    refresh_token: refreshToken,
                    ...(organizationId ? { organization_id: organizationId } : {}),
                }),
            },
            options,
        );
    } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new SessionRefreshUnavailableError();
    }
    if (!response.ok) {
        const code = await readErrorCode(response);
        if (code === 'invalid_grant') {
            throw new SessionRejectedError();
        }
        if (code && REAUTHENTICATION_CODES.has(code)) {
            throw new ReauthenticationRequiredError(code);
        }
        throw new SessionRefreshUnavailableError(
            `Could not renew the CLI session: WorkOS answered ${describeFailure(response, code)}.`,
        );
    }
    try {
        return parseAuthentication(await response.json());
    } catch {
        // WorkOS accepted the grant, so the refresh token is already spent.
        throw new SessionRefreshUnavailableError(
            'WorkOS renewed the CLI session, but its answer could not be read, so the renewed session ' +
                'was not saved. If the next command fails, run `vendure auth login`.',
        );
    }
}

async function workosRequest(
    client: WorkosClient,
    pathname: string,
    init: RequestInit,
    options: AuthOptions,
): Promise<Response> {
    const timeout = AbortSignal.timeout(WORKOS_REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
        return await (options.fetch ?? globalThis.fetch)(`https://${client.apiHostname}${pathname}`, {
            ...init,
            redirect: 'error',
            signal,
        });
    } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new Error('Could not reach the authentication service. Check your connection and try again.');
    }
}

/** WorkOS puts the error code in `error` (OAuth errors) or in `code` (its own errors). */
async function readErrorCode(response: Response): Promise<string | undefined> {
    const body: unknown = await response.json().catch(() => undefined);
    if (!isRecord(body)) {
        return undefined;
    }
    if (typeof body.error === 'string') {
        return body.error;
    }
    return typeof body.code === 'string' ? body.code : undefined;
}

function describeFailure(response: Response, code: string | undefined): string {
    return code ? `${code} (HTTP ${response.status})` : `HTTP ${response.status}`;
}

function parseAuthentication(body: unknown): WorkosAuthentication {
    if (!isRecord(body) || !nonEmpty(body.access_token) || !nonEmpty(body.refresh_token)) {
        throw new Error('WorkOS returned a malformed authentication response.');
    }
    const user = body.user;
    if (!isRecord(user) || !nonEmpty(user.id) || typeof user.email !== 'string') {
        throw new Error('WorkOS returned an authentication response without a user.');
    }
    return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        user: {
            id: user.id,
            email: user.email,
            firstName: typeof user.first_name === 'string' ? user.first_name : null,
            lastName: typeof user.last_name === 'string' ? user.last_name : null,
        },
        organizationId: nonEmpty(body.organization_id) ? body.organization_id : null,
    };
}

function isRecord(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

function positiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
