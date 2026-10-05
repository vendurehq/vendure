import { setTimeout as sleep } from 'node:timers/promises';

import { SessionRefreshUnavailableError, SessionRejectedError } from './auth-errors';
import { AuthOptions, WORKOS_AUTHENTICATE_URL, WORKOS_DEVICE_AUTHORIZE_URL } from './auth-options';
import { AuthUser } from './auth-store';

export const WORKOS_REQUEST_TIMEOUT_MS = 30_000;

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

export async function startDeviceAuthorization(
    clientId: string,
    options: AuthOptions = {},
): Promise<DeviceAuthorization> {
    const response = await workosRequest(
        WORKOS_DEVICE_AUTHORIZE_URL,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ client_id: clientId }).toString(),
        },
        options,
    );
    if (!response.ok) {
        throw new Error(`Could not start the login: WorkOS answered with HTTP ${response.status}.`);
    }
    const body: unknown = await response.json();
    if (
        !isRecord(body) ||
        !nonEmpty(body.device_code) ||
        !nonEmpty(body.user_code) ||
        !nonEmpty(body.verification_uri) ||
        !nonEmpty(body.verification_uri_complete) ||
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
    clientId: string,
    device: DeviceAuthorization,
    options: AuthOptions = {},
): Promise<WorkosAuthentication> {
    const now = options.now ?? Date.now;
    const deadline = now() + device.expiresIn * 1000;
    let interval = device.interval;
    while (now() < deadline) {
        await sleep(interval * 1000, undefined, { signal: options.signal });
        const response = await workosRequest(
            WORKOS_AUTHENTICATE_URL,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                    device_code: device.deviceCode,
                    client_id: clientId,
                }),
            },
            options,
        );
        if (response.ok) {
            return parseAuthentication(await response.json());
        }
        const error = await readErrorCode(response);
        if (error === 'authorization_pending') {
            continue;
        }
        if (error === 'slow_down') {
            interval += 5;
            continue;
        }
        if (error === 'access_denied') {
            throw new Error('The login was denied in the browser.');
        }
        if (error === 'expired_token') {
            break;
        }
        throw new Error(`The login failed: ${error ?? `HTTP ${response.status}`}.`);
    }
    throw new Error('The login code expired before it was approved. Run the login again.');
}

/**
 * Spends a refresh token. Pass `organizationId` to scope the new access token to
 * that WorkOS organization: WorkOS bakes the user's role and permissions in that
 * organization into the token's claims at issue time.
 *
 * Only `invalid_grant` means the token is dead. Every other failure, including
 * a rate limit or an unknown code, is reported as transient so a wrong guess
 * costs the user a retry rather than their login.
 */
export async function exchangeRefreshToken(
    clientId: string,
    refreshToken: string,
    organizationId: string | null,
    options: AuthOptions = {},
): Promise<WorkosAuthentication> {
    let response: Response;
    try {
        response = await workosRequest(
            WORKOS_AUTHENTICATE_URL,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    client_id: clientId,
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
        if ((await readErrorCode(response)) === 'invalid_grant') {
            throw new SessionRejectedError();
        }
        throw new SessionRefreshUnavailableError();
    }
    try {
        return parseAuthentication(await response.json());
    } catch {
        throw new SessionRefreshUnavailableError();
    }
}

async function workosRequest(url: string, init: RequestInit, options: AuthOptions): Promise<Response> {
    const timeout = AbortSignal.timeout(WORKOS_REQUEST_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
        return await (options.fetch ?? globalThis.fetch)(url, { ...init, redirect: 'error', signal });
    } catch (error) {
        if (options.signal?.aborted) throw error;
        throw new Error('Could not reach the authentication service. Check your connection and try again.');
    }
}

async function readErrorCode(response: Response): Promise<string | undefined> {
    const body: unknown = await response.json().catch(() => undefined);
    return isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
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

function positiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
