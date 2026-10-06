import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStoredAuth } from '../../auth/auth-store';

import { ConsoleSession } from './cli-auth';
import { ConsoleCommandDependencies, ConsoleCommandOptions, consoleCommand } from './console';
import { RegisteredConsoleLinkHook } from './console-link-hook';
import { ConsoleReporter } from './console-reporter';
import {
    ACCOUNT_ID,
    FakeConsoleOptions,
    NOW,
    ORGANIZATION_ID,
    OTHER_ACCOUNT_ID,
    OTHER_ORGANIZATION_ID,
    PROJECT_ID,
    STORED_ACCESS_TOKEN,
    STORED_REFRESH_TOKEN,
    WORKOS_AUTHENTICATE_URL,
    WORKOS_DEVICE_AUTHORIZE_URL,
    accessToken,
    createCliConfigDir,
    createVendureProject,
    fakeConsole,
    jsonResponse,
    manifest,
    storeLogin,
} from './console.fixtures';
import { ProjectLinkManifest, getProjectLinkManifestPath } from './project-link-manifest';

/**
 * The official production pair. Nothing reaches the network: every request
 * goes through the injected `fetch`, which answers as Console and WorkOS.
 */
const API_URL = 'https://api.vendure.io';
const OFFICIAL_ENV = {
    VENDURE_CLI_NON_INTERACTIVE: 'true',
    VENDURE_CONSOLE_APP_URL: 'https://console.vendure.io',
    VENDURE_CONSOLE_API_URL: API_URL,
};

const productionManifest: ProjectLinkManifest = {
    ...manifest,
    schemaVersion: 1,
    console: { appOrigin: 'https://console.vendure.io', apiOrigin: API_URL },
};

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('console link command line login', () => {
    it('signs in with the device flow when no login is stored, then links with that login', async () => {
        const run = await runLink({ login: false });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(productionManifest);
        expect(run.messages.join('\n')).toContain('Confirm this code in your browser: ABCD-EFGH');
        expect(run.openedUrls).toEqual(['https://auth.example.com/device?code=ABCD-EFGH']);
        // The login is the one `vendure auth login` stores, so `vendure auth logout` ends it.
        const stored = readStoredAuth({ env: run.env });
        expect(stored?.organization).toEqual({
            workosOrganizationId: ORGANIZATION_ID,
            customerAccountId: ACCOUNT_ID,
            name: 'Acme',
        });
        expect(run.urls()).toEqual([
            `${API_URL}/v1`,
            WORKOS_DEVICE_AUTHORIZE_URL,
            WORKOS_AUTHENTICATE_URL,
            `${API_URL}/v1/me`,
            `${API_URL}/v1/projects`,
            `${API_URL}/v1/projects/${PROJECT_ID}/link`,
        ]);
        expect(run.authorizationFor(`${API_URL}/v1/projects/${PROJECT_ID}/link`)).toBe(
            `Bearer ${stored?.accessToken}`,
        );
    });

    it('never creates a Console CLI Session or a browser-approved Project Link', async () => {
        const run = await runLink({ login: false });

        expect(run.exitCode).toBe(0);
        expect(run.urls().some(url => url.includes('/v1/auth/cli/'))).toBe(false);
        expect(run.urls().some(url => url.includes('/v1/project-links'))).toBe(false);
    });

    it('uses the stored login without opening a browser', async () => {
        const run = await runLink();

        expect(run.exitCode).toBe(0);
        expect(run.openedUrls).toEqual([]);
        expect(run.urls()).toEqual([`${API_URL}/v1/projects`, `${API_URL}/v1/projects/${PROJECT_ID}/link`]);
    });

    it('signs in again when WorkOS has ended the stored login', async () => {
        const run = await runLink({
            storedAccessToken: accessToken('expired', ORGANIZATION_ID, -60),
            console: { refresh: () => jsonResponse({ error: 'invalid_grant' }, 400) },
        });

        expect(run.exitCode).toBe(0);
        expect(run.urls()).toContain(WORKOS_DEVICE_AUTHORIZE_URL);
        expect(readStoredAuth({ env: run.env })?.refreshToken).not.toBe(STORED_REFRESH_TOKEN);
    });

    it('uses the stored login when --organization names its organization', async () => {
        const byName = await runLink({ options: { organization: ' acme ' } });
        const byId = await runLink({ options: { organization: ACCOUNT_ID.toUpperCase() } });

        for (const run of [byName, byId]) {
            expect(run.exitCode).toBe(0);
            expect(run.urls()).not.toContain(WORKOS_DEVICE_AUTHORIZE_URL);
        }
    });

    it('signs in to the organization --organization names when the stored login is for another', async () => {
        const run = await runLink({
            options: { organization: 'Other' },
            console: {
                memberships: [
                    { organizationId: ORGANIZATION_ID, customerAccountId: ACCOUNT_ID, name: 'Acme' },
                    {
                        organizationId: OTHER_ORGANIZATION_ID,
                        customerAccountId: OTHER_ACCOUNT_ID,
                        name: 'Other',
                    },
                ],
            },
        });

        expect(run.exitCode).toBe(0);
        expect(run.urls()).toContain(WORKOS_DEVICE_AUTHORIZE_URL);
        expect(readStoredAuth({ env: run.env })?.organization?.customerAccountId).toBe(OTHER_ACCOUNT_ID);
        expect(run.authorizationFor(`${API_URL}/v1/projects`)).toBe(
            `Bearer ${readStoredAuth({ env: run.env })?.accessToken}`,
        );
    });

    it('refuses a login that is not scoped to an organization, and names --organization', async () => {
        const run = await runLink({ storedOrganization: null });

        expect(run.exitCode).toBe(1);
        expect(run.messages.join('\n')).toContain('--organization');
        expect(run.urls()).toEqual([]);
        expect(fs.existsSync(getProjectLinkManifestPath(run.root))).toBe(false);
    });

    it('reports the sign-in URL and keeps waiting when no browser can be opened', async () => {
        const run = await runLink({
            login: false,
            openUrl: () => Promise.reject(new Error('no browser')),
        });

        expect(run.exitCode).toBe(0);
        expect(run.messages.join('\n')).toContain(
            'If the browser does not open, visit https://auth.example.com/device?code=ABCD-EFGH',
        );
    });

    it('returns an interrupt exit code when the sign-in is interrupted', async () => {
        const abort = new AbortController();
        const run = await runLink({
            login: false,
            signal: abort.signal,
            openUrl: () => {
                abort.abort();
                return Promise.resolve();
            },
        });

        expect(run.exitCode).toBe(130);
        expect(fs.existsSync(getProjectLinkManifestPath(run.root))).toBe(false);
        expect(run.messages.join('\n')).toContain('No Project Link Manifest was changed');
    });

    it.each([
        ['an interactive', true],
        ['a non-interactive', false],
    ])(
        'returns an interrupt exit code when %s repair is interrupted while the login is renewed',
        async (_, interactive) => {
            const abort = new AbortController();
            const hook = vi.fn(async () => undefined);
            const run = await runLink({
                linked: true,
                interactive,
                options: { yes: true },
                storedAccessToken: accessToken('expired', ORGANIZATION_ID, -60),
                signal: abort.signal,
                fetch: () => {
                    abort.abort();
                    return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
                },
                hooks: [{ pluginId: '@example/with-session', requiresSession: true, hook }],
            });

            expect(run.exitCode).toBe(130);
            expect(hook).not.toHaveBeenCalled();
            expect(run.messages.join('\n')).not.toContain('Could not sign in');
        },
    );

    it('returns an interrupt exit code when a link is interrupted while the login is renewed', async () => {
        const abort = new AbortController();
        const run = await runLink({
            storedAccessToken: accessToken('expired', ORGANIZATION_ID, -60),
            signal: abort.signal,
            fetch: () => {
                abort.abort();
                return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
            },
        });

        expect(run.exitCode).toBe(130);
        expect(fs.existsSync(getProjectLinkManifestPath(run.root))).toBe(false);
    });

    it('obtains no session when no plugin asked for one', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({ hooks: [recordingHook(sessions, false)] });

        expect(run.exitCode).toBe(0);
        expect(sessions).toEqual([undefined]);
    });

    it('gives a hook that requested a session the login access token, without its refresh token', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({ hooks: [recordingHook(sessions, true)] });

        expect(run.exitCode).toBe(0);
        expect(sessions).toEqual([{ accessToken: STORED_ACCESS_TOKEN, expiresAt: NOW + 3600 * 1000 }]);
    });

    it('does not expose a session to a hook that did not request one', async () => {
        const requested: Array<ConsoleSession | undefined> = [];
        const other: Array<ConsoleSession | undefined> = [];
        const run = await runLink({ hooks: [recordingHook(requested, true), recordingHook(other, false)] });

        expect(run.exitCode).toBe(0);
        expect(requested[0]?.accessToken).toBe(STORED_ACCESS_TOKEN);
        expect(other).toEqual([undefined]);
    });

    it('gives each requesting hook its own session copy', async () => {
        const seen: ConsoleSession[] = [];
        const mutating: RegisteredConsoleLinkHook = {
            pluginId: '@example/first',
            requiresSession: true,
            hook: async context => {
                if (context.session) {
                    seen.push({ ...context.session });
                    context.session.accessToken = 'changed';
                }
            },
        };
        const reading: RegisteredConsoleLinkHook = {
            pluginId: '@example/second',
            requiresSession: true,
            hook: async context => {
                if (context.session) seen.push(context.session);
            },
        };
        const run = await runLink({ hooks: [mutating, reading] });

        expect(run.exitCode).toBe(0);
        expect(seen.map(session => session.accessToken)).toEqual([STORED_ACCESS_TOKEN, STORED_ACCESS_TOKEN]);
    });

    it('carries the stored login into a repair that a hook needs a session for, asking Console nothing', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({ linked: true, hooks: [recordingHook(sessions, true)] });

        expect(run.exitCode).toBe(0);
        expect(sessions).toEqual([{ accessToken: STORED_ACCESS_TOKEN, expiresAt: NOW + 3600 * 1000 }]);
        expect(run.urls()).toEqual([]);
    });

    it('runs a non-interactive repair without a session when no login is stored, and says so', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({ linked: true, login: false, hooks: [recordingHook(sessions, true)] });

        expect(run.exitCode).toBe(0);
        expect(sessions).toEqual([undefined]);
        expect(run.urls()).toEqual([]);
        expect(run.messages.join('\n')).toContain('No CLI login for Acme is stored on this machine');
    });

    it("signs in to the manifest's account for an interactive repair without a matching login", async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({
            linked: true,
            interactive: true,
            options: { yes: true },
            storedOrganization: {
                workosOrganizationId: OTHER_ORGANIZATION_ID,
                customerAccountId: OTHER_ACCOUNT_ID,
                name: 'Other',
            },
            hooks: [recordingHook(sessions, true)],
        });

        expect(run.exitCode).toBe(0);
        expect(run.urls()).toContain(WORKOS_DEVICE_AUTHORIZE_URL);
        const stored = readStoredAuth({ env: run.env });
        expect(stored?.organization?.customerAccountId).toBe(ACCOUNT_ID);
        expect(sessions[0]?.accessToken).toBe(stored?.accessToken);
    });

    it('keeps a repair going without a session when the sign-in fails', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({
            linked: true,
            interactive: true,
            login: false,
            options: { yes: true },
            fetch: () => Promise.resolve(new Response('{}', { status: 503 })),
            hooks: [recordingHook(sessions, true)],
        });

        expect(run.exitCode).toBe(0);
        expect(sessions).toEqual([undefined]);
        expect(run.messages.join('\n')).toContain('Could not sign in to Vendure Console');
    });
});

interface RunOptions {
    /** Store a login before the run. Defaults to `true`. */
    login?: boolean;
    storedAccessToken?: string;
    storedOrganization?: { workosOrganizationId: string; customerAccountId: string; name: string } | null;
    /** Start from a project that is already linked, so the run is a repair. */
    linked?: boolean;
    interactive?: boolean;
    options?: ConsoleCommandOptions;
    console?: FakeConsoleOptions;
    fetch?: typeof globalThis.fetch;
    hooks?: RegisteredConsoleLinkHook[];
    openUrl?: (url: string) => Promise<void>;
    signal?: AbortSignal;
}

/** Drives `vendure console link` against an in-memory Console and WorkOS. */
async function runLink(options: RunOptions = {}) {
    const root = createVendureProject(temporaryDirectories, 'vendure-console-login-');
    if (options.linked) {
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), productionManifest);
    }
    const env = { ...OFFICIAL_ENV, VENDURE_CLI_CONFIG_DIR: createCliConfigDir(temporaryDirectories) };
    if (options.login !== false) {
        storeLogin(env, API_URL, {
            ...(options.storedAccessToken ? { accessToken: options.storedAccessToken } : {}),
            ...(options.storedOrganization !== undefined ? { organization: options.storedOrganization } : {}),
        });
    }
    const api = fakeConsole(options.console);
    const messages: string[] = [];
    const openedUrls: string[] = [];
    const reporter: ConsoleReporter = {
        error: message => messages.push(message),
        info: message => messages.push(message),
        success: message => messages.push(message),
        warn: message => messages.push(message),
        url: value => messages.push(value),
    };
    const dependencies: Partial<ConsoleCommandDependencies> = {
        cwd: root,
        env,
        fetch: options.fetch ?? api.fetch,
        hooks: options.hooks ?? [],
        isNonInteractive: () => !options.interactive,
        now: () => NOW,
        openUrl: async url => {
            openedUrls.push(url);
            await options.openUrl?.(url);
        },
        prompt: () => Promise.resolve(true),
        select: () => Promise.resolve(undefined),
        reporter,
        signal: options.signal,
    };
    const exitCode = await consoleCommand('link', options.options ?? {}, dependencies);
    return {
        exitCode,
        root,
        env,
        messages,
        openedUrls,
        urls: () => api.requests.map(request => request.url),
        authorizationFor: (url: string) => api.requests.find(request => request.url === url)?.authorization,
    };
}

function recordingHook(
    sessions: Array<ConsoleSession | undefined>,
    requiresSession: boolean,
): RegisteredConsoleLinkHook {
    return {
        pluginId: requiresSession ? '@example/with-session' : '@example/without-session',
        requiresSession,
        hook: async context => {
            sessions.push(context.session);
        },
    };
}
