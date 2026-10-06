import fs from 'fs-extra';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    NotLoggedInError,
    ReauthenticationRequiredError,
    SessionLockUnavailableError,
    SessionRefreshUnavailableError,
    SessionRejectedError,
} from './auth-errors';
import { AuthOptions } from './auth-options';
import {
    getAccessToken,
    listOrganizations,
    loginWithDevice,
    logout,
    readAuthStatus,
    refreshAccessToken,
    SESSION_LOCK_OPTIONS,
} from './auth-session';
import { readStoredAuth, StoredAuth, writeStoredAuth } from './auth-store';

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const USER = { id: 'user_01', email: 'dev@example.com', first_name: 'Ada', last_name: 'Lovelace' };

function jwt(claims: Record<string, unknown>): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

/** An access token that expires `seconds` after NOW. */
function accessToken(seconds: number, extra: Record<string, unknown> = {}): string {
    return jwt({ exp: Math.floor(NOW / 1000) + seconds, ...extra });
}

interface Request {
    url: string;
    body: Record<string, string>;
    authorization?: string;
}

const WORKOS_DEVICE_AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize/device';
const WORKOS_AUTHENTICATE_URL = 'https://api.workos.com/user_management/authenticate';
const PRODUCTION_CLIENT_ID = 'client_01PRODUCTION';
const STAGING_CLIENT_ID = 'client_01STAGING';
const CONSOLE_ME_URL = 'https://api.vendure.io/v1/me';

/** Console's public `GET /v1`, which names the WorkOS client its verifier accepts. */
function serviceInfo(clientId = PRODUCTION_CLIENT_ID) {
    return {
        body: {
            service: 'api',
            authentication: { provider: 'workos', clientId, apiHostname: 'api.workos.com' },
        },
    };
}

/** Holds the session lock as a live process would, and makes waiters give up quickly. */
async function withLockHeldElsewhere(run: () => Promise<void>): Promise<void> {
    writeFileSync(path.join(configDir, 'auth.lock'), `${process.pid}-other-holder`);
    const { waitMs } = SESSION_LOCK_OPTIONS;
    SESSION_LOCK_OPTIONS.waitMs = 20;
    try {
        await run();
    } finally {
        SESSION_LOCK_OPTIONS.waitMs = waitMs;
    }
}
const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';

/** Console's `GET /v1/me`, trimmed to the fields the CLI reads. */
function viewer(memberships: Array<Record<string, unknown>> = MEMBERSHIPS) {
    return { body: { user: { id: USER.id }, memberships } };
}

const MEMBERSHIPS = [
    { organizationId: 'org_1', customerAccountId: ACCOUNT_1, name: 'Bromley Art Supplies', status: 'active' },
    { organizationId: 'org_2', customerAccountId: ACCOUNT_2, name: 'Example GmbH', status: 'active' },
    { organizationId: 'org_3', customerAccountId: null, name: 'Not a Console account', status: 'active' },
    {
        organizationId: 'org_4',
        customerAccountId: '44444444-4444-4444-8444-444444444444',
        name: 'Invited',
        status: 'pending',
    },
];

const DEVICE = {
    body: {
        device_code: 'device_1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.example.com/device',
        verification_uri_complete: 'https://auth.example.com/device?code=ABCD-EFGH',
        expires_in: 300,
        interval: 0.001,
    },
};

/** Answers WorkOS requests from a queue, in order, and records what was sent. */
type FakeResponse = { status?: number; body: unknown };

/** A response, or a function that runs when the request arrives and returns one. */
function fakeWorkos(responses: Array<FakeResponse | (() => FakeResponse)>) {
    const requests: Request[] = [];
    const fetch = ((url: string, init: RequestInit) => {
        const raw = init.body as string | undefined;
        let body: Record<string, string> = {};
        if (url === WORKOS_DEVICE_AUTHORIZE_URL) {
            body = Object.fromEntries(new URLSearchParams(raw));
        } else if (raw) {
            body = JSON.parse(raw) as Record<string, string>;
        }
        const authorization = (init.headers as Record<string, string> | undefined)?.Authorization;
        requests.push({ url, body, ...(authorization ? { authorization } : {}) });
        const queued = responses.shift();
        if (!queued) return Promise.reject(new Error(`Unexpected request to ${url}`));
        const next = typeof queued === 'function' ? queued() : queued;
        const status = next.status ?? 200;
        const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
        return Promise.resolve(new Response(status === 204 ? null : text, { status }));
    }) as typeof globalThis.fetch;
    return { fetch, requests };
}

function authentication(token: string, refreshToken: string, organizationId?: string) {
    return {
        body: {
            access_token: token,
            refresh_token: refreshToken,
            user: USER,
            ...(organizationId ? { organization_id: organizationId } : {}),
        },
    };
}

let configDir: string;
let options: AuthOptions;

function storedAuth(overrides: Partial<StoredAuth> = {}): StoredAuth {
    return {
        version: 1,
        consoleApiUrl: 'https://api.vendure.io',
        clientId: PRODUCTION_CLIENT_ID,
        workosApiHostname: 'api.workos.com',
        accessToken: accessToken(3600),
        refreshToken: 'refresh_1',
        user: { id: USER.id, email: USER.email, firstName: 'Ada', lastName: 'Lovelace' },
        organization: {
            workosOrganizationId: 'org_1',
            customerAccountId: ACCOUNT_1,
            name: 'Bromley Art Supplies',
        },
        ...overrides,
    };
}

beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), 'vendure-auth-'));
    options = { env: { VENDURE_CLI_CONFIG_DIR: configDir }, now: () => NOW };
});

afterEach(() => {
    fs.chmodSync(configDir, 0o700);
    fs.removeSync(configDir);
});

describe('loginWithDevice', () => {
    it('runs the device flow and stores the session at 0600', async () => {
        const token = accessToken(300, { org_id: 'org_1' });
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            { status: 400, body: { error: 'authorization_pending' } },
            authentication(token, 'refresh_1', 'org_1'),
            viewer(),
        ]);
        const shown: string[] = [];

        const status = await loginWithDevice({
            ...options,
            fetch: workos.fetch,
            onDeviceAuthorization: device => {
                shown.push(device.userCode);
            },
        });

        expect(shown).toEqual(['ABCD-EFGH']);
        expect(workos.requests.map(r => r.body.grant_type)).toEqual([
            undefined,
            undefined,
            'urn:ietf:params:oauth:grant-type:device_code',
            'urn:ietf:params:oauth:grant-type:device_code',
            undefined,
        ]);
        expect(workos.requests[0].url).toBe('https://api.vendure.io/v1');
        expect(workos.requests[1].body.client_id).toBe(PRODUCTION_CLIENT_ID);
        expect(status).toMatchObject({
            loggedIn: true,
            organization: { workosOrganizationId: 'org_1', name: 'Bromley Art Supplies' },
            user: { email: 'dev@example.com', firstName: 'Ada' },
        });
        expect(JSON.stringify(status)).not.toContain('refresh_1');
        const file = path.join(configDir, 'auth.json');
        expect((fs.statSync(file).mode % 0o1000).toString(8)).toBe('600');
        expect(readStoredAuth(options)).toMatchObject({ accessToken: token, refreshToken: 'refresh_1' });
    });

    it('still logs in when Console cannot name the organization', async () => {
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            authentication(accessToken(300), 'refresh_1', 'org_1'),
            { status: 503, body: {} },
        ]);

        const status = await loginWithDevice({ ...options, fetch: workos.fetch });

        expect(status.organization).toEqual({
            workosOrganizationId: 'org_1',
            customerAccountId: null,
            name: null,
        });
    });

    it('scopes the session to an organization named by its Account identifier', async () => {
        const deviceToken = accessToken(300, { org_id: 'org_1' });
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            authentication(deviceToken, 'refresh_1', 'org_1'),
            viewer(),
            authentication(accessToken(300, { org_id: 'org_2' }), 'refresh_2', 'org_2'),
        ]);

        const status = await loginWithDevice({ ...options, fetch: workos.fetch, organization: ACCOUNT_2 });

        expect(workos.requests[3]).toEqual({
            url: CONSOLE_ME_URL,
            body: {},
            authorization: `Bearer ${deviceToken}`,
        });
        expect(workos.requests[4].body).toMatchObject({
            grant_type: 'refresh_token',
            refresh_token: 'refresh_1',
            organization_id: 'org_2',
        });
        expect(status.organization).toEqual({
            workosOrganizationId: 'org_2',
            customerAccountId: ACCOUNT_2,
            name: 'Example GmbH',
        });
        expect(readStoredAuth(options)?.refreshToken).toBe('refresh_2');
    });

    it('matches an organization name ignoring case, without re-scoping when already there', async () => {
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            authentication(accessToken(300, { org_id: 'org_1' }), 'refresh_1', 'org_1'),
            viewer(),
        ]);

        const status = await loginWithDevice({
            ...options,
            fetch: workos.fetch,
            organization: 'bromley art supplies',
        });

        expect(workos.requests).toHaveLength(4);
        expect(status.organization?.customerAccountId).toBe(ACCOUNT_1);
    });

    it('refuses an ambiguous name and stores nothing', async () => {
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            authentication(accessToken(300), 'refresh_1'),
            viewer([
                { organizationId: 'org_1', customerAccountId: ACCOUNT_1, name: 'Acme', status: 'active' },
                { organizationId: 'org_2', customerAccountId: ACCOUNT_2, name: 'acme', status: 'active' },
            ]),
        ]);

        await expect(
            loginWithDevice({ ...options, fetch: workos.fetch, organization: 'Acme' }),
        ).rejects.toThrow(/More than one.*\n.*11111111/s);
        expect(readStoredAuth(options)).toBeUndefined();
    });

    it('refuses an organization the user is not an active Console member of, and stores nothing', async () => {
        // Pending membership, and a WorkOS organization with no Customer Account.
        for (const organization of ['Invited', 'Not a Console account']) {
            const run = fakeWorkos([
                serviceInfo(),
                DEVICE,
                authentication(accessToken(300), 'refresh_1'),
                viewer(),
            ]);
            await expect(loginWithDevice({ ...options, fetch: run.fetch, organization })).rejects.toThrow(
                /not an active member.*Example GmbH/s,
            );
        }
        expect(readStoredAuth(options)).toBeUndefined();
    });

    it('refuses a token WorkOS did not scope to the organization asked for', async () => {
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            authentication(accessToken(300, { org_id: 'org_1' }), 'refresh_1', 'org_1'),
            viewer(),
            authentication(accessToken(300, { org_id: 'org_1' }), 'refresh_2'),
        ]);

        await expect(
            loginWithDevice({ ...options, fetch: workos.fetch, organization: ACCOUNT_2 }),
        ).rejects.toThrow('did not scope');
        expect(readStoredAuth(options)).toBeUndefined();
    });

    it('stops before the browser step when Console does not publish its sign-in settings', async () => {
        const workos = fakeWorkos([{ status: 404, body: { code: 'not_found' } }]);

        await expect(loginWithDevice({ ...options, fetch: workos.fetch })).rejects.toThrow(
            'Could not read the sign-in settings from Vendure Console at https://api.vendure.io',
        );
        expect(workos.requests.map(r => r.url)).toEqual(['https://api.vendure.io/v1']);
    });

    it('tells the user to choose an organization in the browser when it requires a new sign-in', async () => {
        const workos = fakeWorkos([
            serviceInfo(),
            DEVICE,
            authentication(accessToken(300, { org_id: 'org_1' }), 'refresh_1', 'org_1'),
            viewer(),
            { status: 400, body: { error: 'sso_required' } },
        ]);

        await expect(
            loginWithDevice({ ...options, fetch: workos.fetch, organization: 'Example GmbH' }),
        ).rejects.toThrow(
            'Example GmbH requires a new sign-in through WorkOS (sso_required). Run `vendure auth login` without --organization and choose Example GmbH in the browser.',
        );
        expect(readStoredAuth(options)).toBeUndefined();
    });

    it('does not write the login while another process holds the lock', async () => {
        const workos = fakeWorkos([serviceInfo(), DEVICE, authentication(accessToken(300), 'refresh_1')]);

        await withLockHeldElsewhere(async () => {
            await expect(loginWithDevice({ ...options, fetch: workos.fetch })).rejects.toBeInstanceOf(
                SessionLockUnavailableError,
            );
        });
        expect(readStoredAuth(options)).toBeUndefined();
    });

    it('signs in with the client the staging Console publishes when staging is selected', async () => {
        const workos = fakeWorkos([
            serviceInfo(STAGING_CLIENT_ID),
            DEVICE,
            authentication(accessToken(300, { org_id: 'org_2' }), 'refresh_1', 'org_2'),
            viewer(),
        ]);
        const staging = {
            ...options,
            env: { ...options.env, VENDURE_CONSOLE_API_URL: 'https://staging.api.vendure.io/' },
        };

        await loginWithDevice({ ...staging, fetch: workos.fetch, organization: 'Example GmbH' });

        expect(workos.requests[0].url).toBe('https://staging.api.vendure.io/v1');
        expect(workos.requests[1].body.client_id).toBe(STAGING_CLIENT_ID);
        expect(workos.requests[3].url).toBe('https://staging.api.vendure.io/v1/me');
        expect(readStoredAuth(staging)).toMatchObject({
            consoleApiUrl: 'https://staging.api.vendure.io',
            clientId: STAGING_CLIENT_ID,
        });
    });

    it('refuses a Console API that is not official or loopback, before any request', async () => {
        const workos = fakeWorkos([]);
        const elsewhere = {
            ...options,
            env: { ...options.env, VENDURE_CONSOLE_API_URL: 'https://attacker.example.com' },
        };

        await expect(
            loginWithDevice({ ...elsewhere, fetch: workos.fetch, organization: 'Acme' }),
        ).rejects.toThrow('is not a Vendure Console API');
        expect(workos.requests).toHaveLength(0);
    });

    it('reports a login denied in the browser', async () => {
        const workos = fakeWorkos([serviceInfo(), DEVICE, { status: 400, body: { error: 'access_denied' } }]);

        await expect(loginWithDevice({ ...options, fetch: workos.fetch })).rejects.toThrow('denied');
        expect(readStoredAuth(options)).toBeUndefined();
    });
});

describe('listOrganizations', () => {
    it('lists active Console organizations with the stored token', async () => {
        const stored = storedAuth();
        writeStoredAuth(stored, options);
        const workos = fakeWorkos([viewer()]);

        const organizations = await listOrganizations({ ...options, fetch: workos.fetch });

        expect(organizations.map(org => org.name)).toEqual(['Bromley Art Supplies', 'Example GmbH']);
        expect(workos.requests[0].authorization).toBe(`Bearer ${stored.accessToken}`);
    });

    it('renews the token once when Console refuses it', async () => {
        writeStoredAuth(storedAuth(), options);
        const renewed = accessToken(300);
        const workos = fakeWorkos([
            { status: 401, body: { code: 'auth.token_expired' } },
            authentication(renewed, 'refresh_2', 'org_1'),
            viewer(),
        ]);

        await expect(listOrganizations({ ...options, fetch: workos.fetch })).resolves.toHaveLength(2);
        expect(workos.requests[2].authorization).toBe(`Bearer ${renewed}`);
    });

    it('uses a loopback Console API in local development', async () => {
        writeStoredAuth(storedAuth({ consoleApiUrl: 'http://localhost:3000' }), options);
        const workos = fakeWorkos([viewer()]);
        const local = {
            ...options,
            env: { ...options.env, VENDURE_CONSOLE_API_URL: 'http://localhost:3000' },
        };

        await listOrganizations({ ...local, fetch: workos.fetch });

        expect(workos.requests[0].url).toBe('http://localhost:3000/v1/me');
    });
});

describe('getAccessToken', () => {
    it('returns undefined when not logged in', async () => {
        await expect(getAccessToken(options)).resolves.toBeUndefined();
    });

    it('returns the stored token while it has life left, without a request', async () => {
        const stored = storedAuth();
        writeStoredAuth(stored, options);
        const workos = fakeWorkos([]);

        await expect(getAccessToken({ ...options, fetch: workos.fetch })).resolves.toBe(stored.accessToken);
        expect(workos.requests).toHaveLength(0);
    });

    it('renews a token close to expiry, keeping the organization scope', async () => {
        writeStoredAuth(storedAuth({ accessToken: accessToken(30) }), options);
        const renewed = accessToken(300);
        const workos = fakeWorkos([authentication(renewed, 'refresh_2', 'org_1')]);

        await expect(getAccessToken({ ...options, fetch: workos.fetch })).resolves.toBe(renewed);
        expect(workos.requests[0]).toEqual({
            url: WORKOS_AUTHENTICATE_URL,
            body: {
                grant_type: 'refresh_token',
                client_id: PRODUCTION_CLIENT_ID,
                refresh_token: 'refresh_1',
                organization_id: 'org_1',
            },
        });
        expect(readStoredAuth(options)).toMatchObject({ accessToken: renewed, refreshToken: 'refresh_2' });
    });

    it('ignores a login for another Vendure Console', async () => {
        writeStoredAuth(storedAuth({ consoleApiUrl: 'https://staging.api.vendure.io' }), options);

        await expect(getAccessToken(options)).resolves.toBeUndefined();
        expect(readAuthStatus(options).loggedIn).toBe(false);
    });

    it('uses the staging login when the staging Console API is selected', async () => {
        const stored = storedAuth({
            consoleApiUrl: 'https://staging.api.vendure.io',
            clientId: STAGING_CLIENT_ID,
        });
        writeStoredAuth(stored, options);
        const staging = {
            ...options,
            env: { ...options.env, VENDURE_CONSOLE_API_URL: 'https://staging.api.vendure.io' },
        };

        await expect(getAccessToken(staging)).resolves.toBe(stored.accessToken);
        await expect(getAccessToken(options)).resolves.toBeUndefined();
    });
});

describe('refreshAccessToken', () => {
    it('reuses a token another process already rotated, without spending the refresh token', async () => {
        const rotated = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: rotated, refreshToken: 'refresh_2' }), options);
        const workos = fakeWorkos([]);

        await expect(
            refreshAccessToken('the-token-that-failed', { ...options, fetch: workos.fetch }),
        ).resolves.toBe(rotated);
        expect(workos.requests).toHaveLength(0);
    });

    it('spends the refresh token once for concurrent callers in one process', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const renewed = accessToken(300);
        const workos = fakeWorkos([authentication(renewed, 'refresh_2', 'org_1')]);
        const withFetch = { ...options, fetch: workos.fetch };

        const results = await Promise.all([
            refreshAccessToken(failed, withFetch),
            refreshAccessToken(failed, withFetch),
        ]);

        expect(results).toEqual([renewed, renewed]);
        expect(workos.requests).toHaveLength(1);
    });

    it('removes the login when WorkOS refuses the refresh token', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const workos = fakeWorkos([{ status: 400, body: { error: 'invalid_grant' } }]);

        await expect(refreshAccessToken(failed, { ...options, fetch: workos.fetch })).rejects.toBeInstanceOf(
            SessionRejectedError,
        );
        expect(readStoredAuth(options)).toBeUndefined();
    });

    it('keeps the login on a transient failure', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const workos = fakeWorkos([{ status: 503, body: { error: 'service_unavailable' } }]);

        await expect(refreshAccessToken(failed, { ...options, fetch: workos.fetch })).rejects.toBeInstanceOf(
            SessionRefreshUnavailableError,
        );
        expect(readStoredAuth(options)?.refreshToken).toBe('refresh_1');
    });

    it('reuses the pair another process stored after spending the same refresh token', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const rotated = accessToken(3600);
        const workos = fakeWorkos([
            () => {
                writeStoredAuth(
                    storedAuth({ accessToken: rotated, refreshToken: 'refresh_rotated' }),
                    options,
                );
                return { status: 400, body: { error: 'invalid_grant' } };
            },
        ]);

        await expect(refreshAccessToken(failed, { ...options, fetch: workos.fetch })).resolves.toBe(rotated);
        expect(workos.requests).toHaveLength(1);
        expect(readStoredAuth(options)?.refreshToken).toBe('refresh_rotated');
    });

    it('spends the rotated refresh token for the organization of the rotated login', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const exampleGmbH = {
            workosOrganizationId: 'org_2',
            customerAccountId: ACCOUNT_2,
            name: 'Example GmbH',
        };
        const renewed = accessToken(300);
        const workos = fakeWorkos([
            () => {
                // A concurrent `vendure auth login --organization` wrote an expired pair for org_2.
                writeStoredAuth(
                    storedAuth({
                        accessToken: accessToken(10),
                        refreshToken: 'refresh_rotated',
                        organization: exampleGmbH,
                    }),
                    options,
                );
                return { status: 400, body: { error: 'invalid_grant' } };
            },
            authentication(renewed, 'refresh_3', 'org_2'),
        ]);

        await expect(refreshAccessToken(failed, { ...options, fetch: workos.fetch })).resolves.toBe(renewed);
        expect(workos.requests[1].body).toMatchObject({
            refresh_token: 'refresh_rotated',
            organization_id: 'org_2',
        });
        expect(readStoredAuth(options)).toMatchObject({
            refreshToken: 'refresh_3',
            organization: exampleGmbH,
        });
    });

    it('does not spend the refresh token while another process holds the lock', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const workos = fakeWorkos([]);

        await withLockHeldElsewhere(async () => {
            await expect(
                refreshAccessToken(failed, { ...options, fetch: workos.fetch }),
            ).rejects.toBeInstanceOf(SessionLockUnavailableError);
        });
        expect(workos.requests).toHaveLength(0);
        expect(readStoredAuth(options)?.refreshToken).toBe('refresh_1');
    });

    it.each([
        ['error', 'sso_required'],
        ['error', 'organization_authentication_methods_required'],
        ['code', 'mfa_enrollment'],
    ])('asks for a new sign-in when WorkOS answers with %s %s, and keeps the login', async (field, code) => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const workos = fakeWorkos([{ status: 403, body: { [field]: code } }]);

        const error = await refreshAccessToken(failed, { ...options, fetch: workos.fetch }).catch(e => e);

        expect(error).toBeInstanceOf(ReauthenticationRequiredError);
        expect(error.code).toBe(code);
        expect(error.message).toBe(
            `WorkOS requires you to sign in again (${code}). Run \`vendure auth login\`.`,
        );
        expect(readStoredAuth(options)?.refreshToken).toBe('refresh_1');
    });

    it('names an unrecognised WorkOS error code', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const workos = fakeWorkos([{ status: 429, body: { code: 'rate_limit_exceeded' } }]);

        await expect(refreshAccessToken(failed, { ...options, fetch: workos.fetch })).rejects.toThrow(
            'Could not renew the CLI session: WorkOS answered rate_limit_exceeded (HTTP 429).',
        );
    });

    it('says the token was spent when WorkOS accepted the grant but its answer cannot be read', async () => {
        const failed = accessToken(3600);
        writeStoredAuth(storedAuth({ accessToken: failed }), options);
        const workos = fakeWorkos([{ status: 200, body: '{"access_token": ' }]);

        await expect(refreshAccessToken(failed, { ...options, fetch: workos.fetch })).rejects.toThrow(
            /answer could not be read.*run `vendure auth login`/,
        );
    });

    it('throws NotLoggedInError without a login', async () => {
        await expect(refreshAccessToken('token', options)).rejects.toBeInstanceOf(NotLoggedInError);
    });

    it.skipIf(process.getuid?.() === 0 || process.platform === 'win32')(
        'does not spend the refresh token when the config directory is not writable',
        async () => {
            const failed = accessToken(3600);
            writeStoredAuth(storedAuth({ accessToken: failed }), options);
            const workos = fakeWorkos([]);
            fs.chmodSync(configDir, 0o500);

            await expect(
                refreshAccessToken(failed, { ...options, fetch: workos.fetch }),
            ).rejects.toBeInstanceOf(SessionLockUnavailableError);
            expect(workos.requests).toHaveLength(0);
        },
    );
});

describe('logout', () => {
    it('ends the session through Console, then removes the login', async () => {
        const stored = storedAuth();
        writeStoredAuth(stored, options);
        const workos = fakeWorkos([{ status: 204, body: null }]);

        await expect(logout({ ...options, fetch: workos.fetch })).resolves.toEqual({
            removed: true,
            sessionEnded: true,
        });
        expect(workos.requests).toEqual([
            {
                url: 'https://api.vendure.io/v1/me/sign-out',
                body: {},
                authorization: `Bearer ${stored.accessToken}`,
            },
        ]);
        expect(fs.existsSync(path.join(configDir, 'auth.json'))).toBe(false);
    });

    it('renews an expired access token before signing out', async () => {
        writeStoredAuth(storedAuth({ accessToken: accessToken(10) }), options);
        const renewed = accessToken(300);
        const workos = fakeWorkos([
            authentication(renewed, 'refresh_2', 'org_1'),
            { status: 204, body: null },
        ]);

        await expect(logout({ ...options, fetch: workos.fetch })).resolves.toEqual({
            removed: true,
            sessionEnded: true,
        });
        expect(workos.requests[1].authorization).toBe(`Bearer ${renewed}`);
    });

    it('still removes the login when Console cannot end the session', async () => {
        writeStoredAuth(storedAuth(), options);
        const fetch = (() => Promise.reject(new Error('offline'))) as typeof globalThis.fetch;

        await expect(logout({ ...options, fetch })).resolves.toEqual({ removed: true, sessionEnded: false });
        expect(fs.existsSync(path.join(configDir, 'auth.json'))).toBe(false);
    });

    it('reports that nobody was logged in', async () => {
        await expect(logout(options)).resolves.toEqual({ removed: false, sessionEnded: false });
    });

    it('keeps the login while another process holds the lock', async () => {
        writeStoredAuth(storedAuth(), options);
        const workos = fakeWorkos([{ status: 204, body: null }]);

        await withLockHeldElsewhere(async () => {
            await expect(logout({ ...options, fetch: workos.fetch })).rejects.toBeInstanceOf(
                SessionLockUnavailableError,
            );
        });
        expect(readStoredAuth(options)?.refreshToken).toBe('refresh_1');
    });
});
