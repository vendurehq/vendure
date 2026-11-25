import {
    CommandAsk,
    CommandContext,
    CommandNotice,
    ErrorResult,
    FailedResult,
    isErrorResult,
    isFailedResult,
} from '@vendure/common/lib/command';
import fs from 'fs-extra';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPendingLoginPath } from '../../auth/auth-options.js';
import { readStoredAuth, writeStoredAuth } from '../../auth/auth-store.js';
import { readPendingLogin } from '../../auth/pending-login.js';
import { executeCommand, HostEnvironment } from '../../command-host/host.js';

import { authLoginDefinition } from './auth.command.js';
import { AuthCommandDependencies } from './auth.js';
import { runLogin } from './login.js';
import { runLogout } from './logout.js';
import { render as renderStatus, runStatus } from './status.js';
import { runWait } from './wait.js';

let configDir: string;
let dependencies: AuthCommandDependencies;

const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url')}.sig`;
const renewedAccessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_448_400 })).toString('base64url')}.sig`;
const AUTHENTICATE_URL = 'https://api.workos.com/user_management/authenticate';
const ACCOUNT_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_2 = '22222222-2222-4222-8222-222222222222';
const deviceAccessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_444_800, org_id: 'org_1' })).toString('base64url')}.sig`;
const scopedAccessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_444_800, org_id: 'org_2' })).toString('base64url')}.sig`;

/** Answers the refresh token grant with `answer` and fails every other request as unreachable. */
function renewalAnswers(answer: { status: number; body: unknown }): typeof globalThis.fetch {
    return ((url: string) => {
        if (url !== AUTHENTICATE_URL) {
            return Promise.reject(new Error('no network in tests'));
        }
        return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }) as typeof globalThis.fetch;
}

const RENEWED = {
    status: 200,
    body: {
        access_token: renewedAccessToken,
        refresh_token: 'refresh_renewed',
        user: { id: 'user_01', email: 'dev@example.com', first_name: 'Ada', last_name: null },
        organization_id: 'org_1',
    },
};
const INVALID_GRANT = { status: 400, body: { error: 'invalid_grant' } };
const INVALID_CLIENT = { status: 400, body: { error: 'invalid_client' } };

function storeLogin(consoleApiUrl = 'https://api.vendure.io') {
    writeStoredAuth(
        {
            version: 1,
            consoleApiUrl,
            clientId: 'client_01PRODUCTION',
            workosApiHostname: 'api.workos.com',
            accessToken,
            refreshToken: 'refresh_secret',
            user: { id: 'user_01', email: 'dev@example.com', firstName: 'Ada', lastName: null },
            organization: {
                workosOrganizationId: 'org_1',
                customerAccountId: ACCOUNT_1,
                name: 'Bromley Art Supplies',
            },
        },
        dependencies,
    );
}

function makeContext(options: { ask?: Partial<CommandAsk>; mcp?: boolean } = {}) {
    const notices: CommandNotice[] = [];
    const ctx: CommandContext = {
        cwd: configDir,
        signal: new AbortController().signal,
        mcp: options.mcp ?? false,
        ...(options.ask
            ? {
                  ask: {
                      confirm: () => Promise.resolve(undefined),
                      select: () => Promise.resolve(undefined),
                      text: () => Promise.resolve(undefined),
                      ...options.ask,
                  },
              }
            : {}),
        notice: (level, message) => notices.push({ level, message }),
        progress: () => undefined,
        output: () => undefined,
        event: () => undefined,
        spawn: () => Promise.reject(new Error('no processes in tests')),
    };
    return { ctx, notices, messages: () => notices.map(notice => notice.message) };
}

interface DeviceAnswers {
    fetch: typeof globalThis.fetch;
    /** How often the device code grant was polled. */
    polls: () => number;
}

/**
 * Vendure Console and the authentication service for one device login by a member of two
 * organizations. The device code grant answers `authorization_pending` `pendingPolls` times, then
 * `final`, which defaults to the approval.
 */
function deviceLoginAnswers(
    options: {
        browserOrganization?: string | null;
        pendingPolls?: number;
        final?: { status: number; body: unknown };
        interval?: number;
    } = {},
): DeviceAnswers {
    const browserOrganization =
        options.browserOrganization === undefined ? 'org_1' : options.browserOrganization;
    const user = { id: 'user_01', email: 'dev@example.com', first_name: 'Ada', last_name: null };
    let polls = 0;
    const answers: Record<string, (body: string | undefined) => { status: number; body: unknown }> = {
        'https://api.vendure.io/v1': () => ({
            status: 200,
            body: {
                service: 'api',
                authentication: {
                    provider: 'workos',
                    clientId: 'client_01PRODUCTION',
                    apiHostname: 'api.workos.com',
                },
            },
        }),
        'https://api.workos.com/user_management/authorize/device': () => ({
            status: 200,
            body: {
                device_code: 'device_secret_1',
                user_code: 'ABCD-EFGH',
                verification_uri: 'https://auth.example.com/device',
                verification_uri_complete: 'https://auth.example.com/device?code=ABCD-EFGH',
                expires_in: 300,
                interval: options.interval ?? 0.001,
            },
        }),
        [AUTHENTICATE_URL]: body => {
            if (body?.includes('"organization_id":"org_2"')) {
                return {
                    status: 200,
                    body: {
                        access_token: scopedAccessToken,
                        refresh_token: 'refresh_2',
                        user,
                        organization_id: 'org_2',
                    },
                };
            }
            polls++;
            if (polls <= (options.pendingPolls ?? 0)) {
                return { status: 400, body: { error: 'authorization_pending' } };
            }
            return (
                options.final ?? {
                    status: 200,
                    body: {
                        access_token: browserOrganization ? deviceAccessToken : accessToken,
                        refresh_token: 'refresh_1',
                        user,
                        ...(browserOrganization ? { organization_id: browserOrganization } : {}),
                    },
                }
            );
        },
        'https://api.vendure.io/v1/me': () => ({
            status: 200,
            body: {
                user: { id: 'user_01' },
                memberships: [
                    {
                        organizationId: 'org_1',
                        customerAccountId: ACCOUNT_1,
                        name: 'Bromley Art Supplies',
                        status: 'active',
                    },
                    {
                        organizationId: 'org_2',
                        customerAccountId: ACCOUNT_2,
                        name: 'Example GmbH',
                        status: 'active',
                    },
                ],
            },
        }),
    };
    const fetch = ((url: string, init?: RequestInit) => {
        const answer = answers[url];
        if (!answer) {
            return Promise.reject(new Error(`Unexpected request to ${url}`));
        }
        const { status, body } = answer(typeof init?.body === 'string' ? init.body : undefined);
        return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }) as typeof globalThis.fetch;
    return { fetch, polls: () => polls };
}

/** A clock that only moves when the poll sleeps, so a wait of minutes takes no time. */
function fakeClock() {
    let now = Date.now();
    return {
        now: () => now,
        sleep: (ms: number) => {
            now += ms;
            return Promise.resolve();
        },
        advance: (ms: number) => (now += ms),
    };
}

function expectError(result: unknown, code: string) {
    expect(isErrorResult(result)).toBe(true);
    expect((result as ErrorResult).code).toBe(code);
}

beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), 'vendure-auth-command-'));
    dependencies = {
        env: { VENDURE_CLI_CONFIG_DIR: configDir },
        fetch: () => Promise.reject(new Error('no network in tests')),
        openUrl: () => Promise.resolve(),
    };
});

afterEach(() => {
    fs.removeSync(configDir);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('vendure auth status', () => {
    it('is a failed result when not logged in', async () => {
        const result = await runStatus(makeContext().ctx, dependencies);

        expect(isFailedResult(result)).toBe(true);
        expect(renderStatus((result as FailedResult<any>).output)).toContain('vendure auth login');
    });

    it('returns the login without tokens', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            fetch: renewalAnswers(RENEWED),
        });

        expect(result).toMatchObject({
            loggedIn: true,
            organization: { name: 'Bromley Art Supplies' },
            user: { email: 'dev@example.com' },
            consoleApiUrl: 'https://api.vendure.io',
            clientId: 'client_01PRODUCTION',
            renewable: true,
        });
        const text = JSON.stringify(result);
        for (const secret of ['refresh_secret', 'refresh_renewed', accessToken, renewedAccessToken]) {
            expect(text).not.toContain(secret);
        }
    });

    it('points out a login stored for another Vendure Console', async () => {
        storeLogin('https://staging.api.vendure.io');

        const result = await runStatus(makeContext().ctx, dependencies);

        const status = (result as FailedResult<any>).output;
        expect(status.otherConsoleLogin).toBe(true);
        expect(renderStatus(status)).toContain('VENDURE_CONSOLE_API_URL');
    });

    it('shows the organization name and Account identifier', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            fetch: renewalAnswers(RENEWED),
        });

        expect(renderStatus(result as any)).toContain(
            `Organization: Bromley Art Supplies (Account identifier ${ACCOUNT_1})`,
        );
    });

    it('reports a refresh token the authentication service refused, with its code', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            fetch: renewalAnswers(INVALID_GRANT),
        });

        const status = (result as FailedResult<any>).output;
        expect(status).toMatchObject({ loggedIn: false, renewable: false });
        expect(renderStatus(status)).toBe(
            'The stored login for dev@example.com can no longer be renewed (invalid_grant, HTTP 400). ' +
                'Run `vendure auth login` to sign in again.',
        );
    });

    it('reports the login and warns when the renewal cannot be checked', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, dependencies);

        expect(isFailedResult(result)).toBe(false);
        expect(renderStatus(result as any)).toContain('Could not check that the login can be renewed');
    });

    it('says what to do when the renewed token would be too big', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            fetch: renewalAnswers({ status: 400, body: { error: 'token_too_big' } }),
        });

        expect(renderStatus((result as FailedResult<any>).output)).toBe(
            'The stored login for dev@example.com can no longer be renewed (token_too_big, HTTP 400). ' +
                'Your account holds too many roles in the organization for a sign-in token. ' +
                'Ask an organization admin to remove the roles you do not need from your membership, then try again. ' +
                'Run `vendure auth login` to sign in again.',
        );
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('keeps the login when the renewal is refused for another reason', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            fetch: renewalAnswers(INVALID_CLIENT),
        });

        expect((result as FailedResult<any>).output).toMatchObject({
            renewable: false,
            renewalError: { code: 'invalid_client', status: 400 },
        });
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('renews the login, rotating the stored refresh token', async () => {
        storeLogin();

        await runStatus(makeContext().ctx, { ...dependencies, fetch: renewalAnswers(RENEWED) });

        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_renewed');
    });

    it('says how to choose an organization by name when Console could not name it', async () => {
        storeLogin();
        const stored = readStoredAuth(dependencies);
        if (!stored) {
            throw new Error('The login was not stored');
        }
        writeStoredAuth(
            {
                ...stored,
                organization: { workosOrganizationId: 'org_1', customerAccountId: null, name: null },
            },
            dependencies,
        );

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            fetch: renewalAnswers(RENEWED),
        });

        expect(renderStatus(result as any)).toContain(
            'Organization: org_1 (name unknown; run `vendure auth login --organization <Account identifier or name>` to choose it by name)',
        );
    });

    it('does not name the identity provider', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, dependencies);

        expect(renderStatus(result as any)).not.toMatch(/workos/i);
    });

    it('reports VENDURE_CLOUD_TOKEN as the credential when no login is stored, without the token', async () => {
        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            env: { ...dependencies.env, VENDURE_CLOUD_TOKEN: 'vcdk_agent_key' },
        });

        expect(isFailedResult(result)).toBe(false);
        expect(result).toMatchObject({ loggedIn: false, credential: 'environment' });
        expect(JSON.stringify(result)).not.toContain('vcdk_agent_key');
        expect(renderStatus(result as any)).toBe(
            'Commands use VENDURE_CLOUD_TOKEN, because no login is stored for https://api.vendure.io.',
        );
    });

    it('says VENDURE_CLOUD_TOKEN is used because the stored login was refused', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            env: { ...dependencies.env, VENDURE_CLOUD_TOKEN: 'vcdk_agent_key' },
            fetch: renewalAnswers(INVALID_GRANT),
        });

        expect(result).toMatchObject({ renewable: false, credential: 'environment' });
        const text = renderStatus(result as any);
        expect(text).toContain('can no longer be renewed (invalid_grant, HTTP 400)');
        expect(text).toContain(
            'Commands use VENDURE_CLOUD_TOKEN, because the stored login can no longer be renewed.',
        );
        expect(text).not.toContain('no login is stored');
    });

    it('reports the stored login as the credential even when VENDURE_CLOUD_TOKEN is set', async () => {
        storeLogin();

        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            env: { ...dependencies.env, VENDURE_CLOUD_TOKEN: 'vcdk_agent_key' },
            fetch: renewalAnswers(RENEWED),
        });

        expect(result).toMatchObject({ loggedIn: true, credential: 'stored-login' });
    });

    it('refuses an unknown Console API', async () => {
        const result = await runStatus(makeContext().ctx, {
            ...dependencies,
            env: { ...dependencies.env, VENDURE_CONSOLE_API_URL: 'https://attacker.example.com' },
        });

        expectError(result, 'auth.console-api-invalid');
    });
});

describe('vendure auth login with a person at the terminal', () => {
    it('keeps the existing login when the person declines to replace it', async () => {
        storeLogin();
        const prompts: string[] = [];
        const { ctx, messages } = makeContext({
            ask: {
                confirm: message => {
                    prompts.push(message);
                    return Promise.resolve(false);
                },
            },
        });

        const result = await runLogin({}, ctx, { ...dependencies, fetch: renewalAnswers(RENEWED) });

        expect(prompts).toEqual(['Already logged in as dev@example.com. Sign in again?']);
        expect(result).toMatchObject({ loggedIn: true, user: { email: 'dev@example.com' } });
        expect(messages()).toContain('Kept the stored login.');
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_renewed');
    });

    // A login that can no longer be renewed is replaced without asking whether to replace it.
    it.each([
        ['invalid_grant', INVALID_GRANT],
        ['invalid_client', INVALID_CLIENT],
    ])('goes straight to sign-in when the renewal is refused with %s', async (code, answer) => {
        storeLogin();
        const confirm = vi.fn(() => Promise.resolve(false));
        const { ctx, messages } = makeContext({ ask: { confirm } });

        const result = await runLogin({}, ctx, { ...dependencies, fetch: renewalAnswers(answer) });

        expect(confirm).not.toHaveBeenCalled();
        expect(messages()[0]).toBe(
            `The stored login for dev@example.com can no longer be renewed (${code}, HTTP 400). Signing in again.`,
        );
        // The sign-in itself starts at Vendure Console, which is unreachable here.
        expectError(result, 'auth.login-failed');
    });

    it('shows the code, opens the browser, and asks which organization to use', async () => {
        const opened: string[] = [];
        const offered: string[] = [];
        const { ctx, messages } = makeContext({
            ask: {
                select: (_message, choices) => {
                    offered.push(...choices.map(choice => choice.label));
                    return Promise.resolve('org_2');
                },
            },
        });

        const result = await runLogin({}, ctx, {
            ...dependencies,
            fetch: deviceLoginAnswers().fetch,
            openUrl: url => {
                opened.push(url);
                return Promise.resolve();
            },
        });

        expect(messages()[0]).toContain('Confirm this code in your browser: ABCD-EFGH');
        expect(opened).toEqual(['https://auth.example.com/device?code=ABCD-EFGH']);
        expect(offered).toEqual([`Bromley Art Supplies (${ACCOUNT_1})`, `Example GmbH (${ACCOUNT_2})`]);
        expect(result).toMatchObject({ loggedIn: true, organization: { name: 'Example GmbH' } });
        expect(readStoredAuth(dependencies)?.organization?.name).toBe('Example GmbH');
        expect(readPendingLogin(dependencies)).toBeUndefined();
    });

    it('asks before replacing a login whose renewal cannot be checked, and says so', async () => {
        storeLogin();
        const confirm = vi.fn(() => Promise.resolve(false));
        const { ctx, messages } = makeContext({ ask: { confirm } });

        await runLogin({}, ctx, dependencies);

        expect(confirm).toHaveBeenCalledOnce();
        expect(messages()[0]).toBe(
            'Could not check that the stored login can be renewed: ' +
                'Could not reach the authentication service to renew your CLI session.',
        );
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('removes an older pending login once the person has signed in', async () => {
        const device = deviceLoginAnswers();
        await runLogin({}, makeContext().ctx, { ...dependencies, fetch: device.fetch });

        await runLogin({}, makeContext({ ask: { select: () => Promise.resolve('org_1') } }).ctx, {
            ...dependencies,
            fetch: device.fetch,
        });

        expect(readPendingLogin(dependencies)).toBeUndefined();
    });

    it('stores nothing when the choice is cancelled', async () => {
        const { ctx } = makeContext({ ask: {} });

        const result = await runLogin({}, ctx, { ...dependencies, fetch: deviceLoginAnswers().fetch });

        expectError(result, 'cli.cancelled');
        expect(readStoredAuth(dependencies)).toBeUndefined();
    });
});

describe('vendure auth login without a person', () => {
    it('returns the URL and code at once and saves the pending login at 0600', async () => {
        const device = deviceLoginAnswers();
        const { ctx, messages } = makeContext();

        const result = await runLogin({ organization: 'Example GmbH' }, ctx, {
            ...dependencies,
            fetch: device.fetch,
        });

        expect(result).toEqual({
            status: 'pending',
            url: 'https://auth.example.com/device?code=ABCD-EFGH',
            code: 'ABCD-EFGH',
            expiresAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
        });
        expect(device.polls()).toBe(0);
        expect(JSON.stringify(result)).not.toContain('device_secret_1');
        expect(messages().join('\n')).toContain('vendure auth wait');
        const file = getPendingLoginPath(dependencies);
        expect(JSON.parse(readFileSync(file, 'utf-8'))).toMatchObject({
            deviceCode: 'device_secret_1',
            organization: 'Example GmbH',
        });
        if (process.platform !== 'win32') {
            expect((statSync(file).mode % 0o1000).toString(8)).toBe('600');
        }
        expect(readStoredAuth(dependencies)).toBeUndefined();
    });

    it('says that a stored login stays until the new one is approved', async () => {
        storeLogin();
        const { ctx, messages } = makeContext();

        await runLogin({}, ctx, { ...dependencies, fetch: deviceLoginAnswers().fetch });

        expect(messages()[0]).toContain('This machine is logged in as dev@example.com.');
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('returns pending through the host as an MCP tool call, with no prompter', async () => {
        vi.stubEnv('VENDURE_CLI_CONFIG_DIR', configDir);
        vi.stubEnv('VENDURE_CONSOLE_API_URL', '');
        vi.stubGlobal('fetch', deviceLoginAnswers().fetch);
        const env: HostEnvironment = {
            cwd: configDir,
            signal: new AbortController().signal,
            mcp: true,
            emit: () => undefined,
            spawn: () => Promise.reject(new Error('no processes in tests')),
            findProjectRoot: () => undefined,
        };

        const { envelope, exitCode } = await executeCommand(authLoginDefinition, {}, env);

        expect(exitCode).toBe(0);
        expect(envelope).toMatchObject({ status: 'ok', output: { status: 'pending', code: 'ABCD-EFGH' } });
    });
});

describe('vendure auth wait', () => {
    async function startPending(device: DeviceAnswers, organization?: string) {
        await runLogin({ organization }, makeContext().ctx, { ...dependencies, fetch: device.fetch });
    }

    it('is a coded error with the login fix when no login is pending', async () => {
        const result = await runWait({}, makeContext().ctx, dependencies);

        expectError(result, 'auth.no-pending-login');
        expect((result as ErrorResult).details).toEqual({ reason: 'missing' });
    });

    it('removes an expired pending login and reports it', async () => {
        const device = deviceLoginAnswers();
        await startPending(device);
        const clock = fakeClock();
        clock.advance(301_000);

        const result = await runWait({}, makeContext().ctx, {
            ...dependencies,
            fetch: device.fetch,
            ...clock,
        });

        expectError(result, 'auth.no-pending-login');
        expect((result as ErrorResult).details).toEqual({ reason: 'expired' });
        expect(readPendingLogin(dependencies)).toBeUndefined();
        expect(device.polls()).toBe(0);
    });

    it('returns the pending login again when the timeout passes, and keeps it', async () => {
        const device = deviceLoginAnswers({ pendingPolls: 1000, interval: 5 });
        await startPending(device);
        const clock = fakeClock();
        const { ctx, messages } = makeContext();

        const result = await runWait({ timeout: 20 }, ctx, {
            ...dependencies,
            fetch: device.fetch,
            ...clock,
        });

        expect(result).toMatchObject({ status: 'pending', code: 'ABCD-EFGH' });
        expect(device.polls()).toBe(5);
        expect(messages().join('\n')).toContain('Run `vendure auth wait` again');
        expect(readPendingLogin(dependencies)).toMatchObject({ code: 'ABCD-EFGH' });
    });

    it('waits 30 seconds by default as an MCP tool', async () => {
        const device = deviceLoginAnswers({ pendingPolls: 1000, interval: 5 });
        await startPending(device);
        const clock = fakeClock();
        const startedAt = clock.now();

        const result = await runWait({}, makeContext({ mcp: true }).ctx, {
            ...dependencies,
            fetch: device.fetch,
            ...clock,
        });

        expect(result).toMatchObject({ status: 'pending' });
        expect(clock.now() - startedAt).toBe(30_000);
    });

    it('finishes the login once the code is approved, scoped to the organization it was started with', async () => {
        const device = deviceLoginAnswers({ pendingPolls: 2 });
        await startPending(device, 'Example GmbH');

        const result = await runWait({}, makeContext().ctx, { ...dependencies, fetch: device.fetch });

        expect(result).toEqual({
            loggedIn: true,
            consoleApiUrl: 'https://api.vendure.io',
            user: { id: 'user_01', email: 'dev@example.com', firstName: 'Ada', lastName: null },
            organization: {
                workosOrganizationId: 'org_2',
                customerAccountId: ACCOUNT_2,
                name: 'Example GmbH',
            },
        });
        expect(JSON.stringify(result)).not.toMatch(/refresh_|e30\./);
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_2');
        expect(readPendingLogin(dependencies)).toBeUndefined();
    });

    it('keeps the browser choice without a person and says how to pick another', async () => {
        const device = deviceLoginAnswers();
        await startPending(device);
        const { ctx, messages } = makeContext();

        const result = await runWait({}, ctx, { ...dependencies, fetch: device.fetch });

        expect(result).toMatchObject({ organization: { name: 'Bromley Art Supplies' } });
        expect(messages()).toContain(
            `You belong to more than one organization, and this login uses Bromley Art Supplies (Account identifier ${ACCOUNT_1}). ` +
                'To use another, run `vendure auth login --organization <Account identifier or name>`.',
        );
    });

    it('says the login has none of them when the browser chose no organization', async () => {
        const device = deviceLoginAnswers({ browserOrganization: null });
        await startPending(device);
        const { ctx, messages } = makeContext();

        await runWait({}, ctx, { ...dependencies, fetch: device.fetch });

        expect(messages()).toContain(
            'You belong to more than one organization, and this login uses none of them. ' +
                'To use another, run `vendure auth login --organization <Account identifier or name>`.',
        );
    });

    it('reports a denial to a parallel wait instead of the login already stored', async () => {
        storeLogin();
        const device = deviceLoginAnswers({
            pendingPolls: 20,
            final: { status: 400, body: { error: 'access_denied' } },
        });
        await startPending(device);
        const options = { ...dependencies, fetch: device.fetch };

        const results = await Promise.all([
            runWait({ timeout: 10 }, makeContext().ctx, options),
            runWait({ timeout: 10 }, makeContext().ctx, options),
        ]);

        for (const result of results) {
            expectError(result, 'auth.login-denied');
        }
    });

    it('ends the pending login when the code was spent but the login failed', async () => {
        const device = deviceLoginAnswers();
        await startPending(device, 'No Such Organization');

        const result = await runWait({}, makeContext().ctx, { ...dependencies, fetch: device.fetch });

        expectError(result, 'auth.login-failed');
        expect(readPendingLogin(dependencies)).toBeUndefined();
        const again = await runWait({}, makeContext().ctx, { ...dependencies, fetch: device.fetch });
        expectError(again, 'auth.no-pending-login');
    });

    it('stops polling a code that a new login replaced, and returns the new one', async () => {
        const device = deviceLoginAnswers({ pendingPolls: 1000, interval: 5 });
        await startPending(device);
        const clock = fakeClock();
        let polls = 0;
        const replacing: typeof globalThis.fetch = async (url, init) => {
            const response = await device.fetch(url, init);
            if (String(url) === AUTHENTICATE_URL && ++polls === 2) {
                const file = getPendingLoginPath(dependencies);
                const record = JSON.parse(readFileSync(file, 'utf-8'));
                writeFileSync(
                    file,
                    JSON.stringify({ ...record, deviceCode: 'device_2', userCode: 'WXYZ-1234' }),
                );
            }
            return response;
        };

        const result = await runWait({ timeout: 300 }, makeContext().ctx, {
            ...dependencies,
            fetch: replacing,
            ...clock,
        });

        expect(result).toMatchObject({ status: 'pending', code: 'WXYZ-1234' });
        expect(polls).toBe(2);
    });

    it('starts a new login at once while a wait holds the lock, and the wait returns the new code', async () => {
        const device = deviceLoginAnswers({ pendingPolls: 1000, interval: 0.02 });
        await startPending(device);
        const waiting = runWait({ timeout: 5 }, makeContext().ctx, { ...dependencies, fetch: device.fetch });
        const lock = path.join(configDir, 'auth-pending.lock');
        for (let i = 0; i < 100 && !fs.existsSync(lock); i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(fs.existsSync(lock)).toBe(true);

        const startedAt = Date.now();
        const replacement = deviceLoginAnswers({ pendingPolls: 1000 });
        const answers = replacement.fetch;
        await runLogin({}, makeContext().ctx, {
            ...dependencies,
            fetch: async (url, init) => {
                const response = await answers(url, init);
                if (String(url).endsWith('/authorize/device')) {
                    const body = (await response.json()) as Record<string, unknown>;
                    return new Response(
                        JSON.stringify({ ...body, device_code: 'device_2', user_code: 'WXYZ-1234' }),
                    );
                }
                return response;
            },
        });

        expect(Date.now() - startedAt).toBeLessThan(1000);
        await expect(waiting).resolves.toMatchObject({ status: 'pending', code: 'WXYZ-1234' });
    });

    it('polls once even when the timeout is shorter than the interval', async () => {
        const device = deviceLoginAnswers({ interval: 5 });
        await startPending(device);
        const clock = fakeClock();

        const result = await runWait({ timeout: 1 }, makeContext().ctx, {
            ...dependencies,
            fetch: device.fetch,
            ...clock,
        });

        expect(result).toMatchObject({ loggedIn: true });
        expect(device.polls()).toBe(1);
    });

    it('reports a denied code and removes the pending login', async () => {
        const device = deviceLoginAnswers({ final: { status: 400, body: { error: 'access_denied' } } });
        await startPending(device);

        const result = await runWait({}, makeContext().ctx, { ...dependencies, fetch: device.fetch });

        expectError(result, 'auth.login-denied');
        expect(readPendingLogin(dependencies)).toBeUndefined();
        expect(readStoredAuth(dependencies)).toBeUndefined();
    });

    it('reports a code that expired while waiting and removes the pending login', async () => {
        const device = deviceLoginAnswers({ final: { status: 400, body: { error: 'expired_token' } } });
        await startPending(device);

        const result = await runWait({}, makeContext().ctx, { ...dependencies, fetch: device.fetch });

        expectError(result, 'auth.login-expired');
        expect(readPendingLogin(dependencies)).toBeUndefined();
    });

    it('lets only one of two parallel waits poll, and both report the login', async () => {
        const device = deviceLoginAnswers({ pendingPolls: 20 });
        await startPending(device);
        const options = { ...dependencies, fetch: device.fetch };

        const [first, second] = await Promise.all([
            runWait({ timeout: 10 }, makeContext().ctx, options),
            runWait({ timeout: 10 }, makeContext().ctx, options),
        ]);

        expect(first).toMatchObject({ loggedIn: true });
        expect(second).toMatchObject({ loggedIn: true });
        expect(device.polls()).toBe(21);
    });
});

describe('vendure auth logout', () => {
    it('ends the session and removes the login and a pending login', async () => {
        storeLogin();
        await runLogin({}, makeContext().ctx, { ...dependencies, fetch: deviceLoginAnswers().fetch });
        const fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof globalThis.fetch;
        const { ctx, notices } = makeContext();

        const result = await runLogout(ctx, { ...dependencies, fetch });

        expect(result).toEqual({ removed: true, sessionEnded: true });
        expect(notices).toEqual([]);
        expect(readStoredAuth(dependencies)).toBeUndefined();
        expect(readPendingLogin(dependencies)).toBeUndefined();
    });

    it('warns that copies keep working when Console cannot end the session', async () => {
        storeLogin();
        const { ctx, messages } = makeContext();

        const result = await runLogout(ctx, dependencies);

        expect(result).toEqual({ removed: true, sessionEnded: false });
        expect(messages()).toEqual([
            'Vendure Console could not end the session, so a copy of this login keeps working until it expires.',
        ]);
    });
});
