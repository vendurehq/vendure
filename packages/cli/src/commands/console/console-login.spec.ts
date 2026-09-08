import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleSession } from './cli-auth';
import { ConsoleCommandDependencies, ConsoleReporter, consoleCommand } from './console';
import { ConsoleLinkContext } from './console-link-hook';
import { LINK_ID, POLLING_SECRET, manifest } from './console.fixtures';
import { getProjectLinkManifestPath } from './project-link-manifest';

/**
 * The official production pair, so the origin gate opens. Nothing reaches the
 * network: every request goes through the injected `fetch`, and the only real
 * socket is the loopback listener the client binds on this machine.
 */
const OFFICIAL_ENV = {
    VENDURE_CLI_NON_INTERACTIVE: 'true',
    VENDURE_CONSOLE_LINK_URL: 'https://console.vendure.io',
    VENDURE_CONSOLE_LINK_API_URL: 'https://api.vendure.io',
};

const ACCESS_TOKEN = 'vcli_access-token';
const REFRESH_TOKEN = 'vclr_refresh-token';

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('console link command line login', () => {
    it('settles the link and the session from one browser approval', async () => {
        const test = await runLink();

        expect(test.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(test.root))).toEqual(manifest);
        // One approval. The browser was opened once and never sent to the
        // standalone sign-in page.
        expect(test.openedUrls).toHaveLength(1);
        expect(new URL(test.openedUrls[0]).pathname).not.toBe('/cli-auth');

        // All five parameters, on the verification URL Console already returned.
        const opened = new URL(test.openedUrls[0]);
        expect(opened.searchParams.get('client')).toBe('cli');
        expect(opened.searchParams.get('code_challenge_method')).toBe('S256');
        expect(opened.searchParams.get('state')).toBeTruthy();
        const redirectUri = opened.searchParams.get('redirect_uri') ?? '';
        expect(new URL(redirectUri).hostname).toBe('127.0.0.1');
        expect(new URL(redirectUri).pathname).toBe('/auth/callback');

        // The exchange proved possession of the verifier behind the challenge.
        expect(createHash('sha256').update(test.grant.code_verifier).digest('base64url')).toBe(
            opened.searchParams.get('code_challenge'),
        );
        expect(test.grant.grant_type).toBe('authorization_code');
        expect(test.grant.redirect_uri).toBe(redirectUri);

        expect(test.sessions).toEqual([
            { accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, expiresAt: expect.any(Number) },
        ]);
    });

    it('links without a session when the Console does not settle a login, and says so', async () => {
        const test = await runLink({ supports: [] });

        expect(test.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(test.root))).toEqual(manifest);
        // No login was requested, so the verification URL is the plain one.
        expect(new URL(test.openedUrls[0]).searchParams.get('client')).toBeNull();
        expect(test.sessions).toEqual([undefined]);
        expect(test.messages.join('\n')).toContain('does not settle a command line login');
    });

    it('asks for the link alone when no browser can be opened here', async () => {
        const test = await runLink({ openUrl: () => Promise.reject(new Error('no browser')) });

        expect(test.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(test.root))).toEqual(manifest);
        // The URL offered for another machine carries no callback address,
        // because that address is only reachable from this one.
        const printed = test.messages.find(message => message.startsWith('https://'));
        expect(printed).toBeDefined();
        expect(new URL(printed ?? '').searchParams.get('redirect_uri')).toBeNull();
        expect(test.sessions).toEqual([undefined]);
        // Said before the person approves, not after.
        expect(test.messages.join('\n')).toContain('will not obtain a Console session');
    });

    it('keeps the link when the browser approved somewhere the callback cannot reach', async () => {
        // The approval happens, so the poll completes, but nothing ever calls
        // the listener on this machine.
        const test = await runLink({ openUrl: () => Promise.resolve() });

        expect(test.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(test.root))).toEqual(manifest);
        expect(test.sessions).toEqual([undefined]);
        expect(test.messages.join('\n')).toContain('no Console session was obtained');
    });

    it('keeps the link when the token exchange is refused', async () => {
        const test = await runLink({ tokenStatus: 400 });

        expect(test.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(test.root))).toEqual(manifest);
        expect(test.sessions).toEqual([undefined]);
        expect(test.messages.join('\n')).toContain('could not be obtained');
    });

    it('never carries a session into a repair, which asks Console nothing', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const contexts: ConsoleLinkContext[] = [];
        const fetchMock = vi.fn() as unknown as typeof fetch;

        const exitCode = await consoleCommand(
            'link',
            {},
            {
                ...baseDependencies(root),
                env: OFFICIAL_ENV,
                fetch: fetchMock,
                hooks: [
                    {
                        pluginId: '@example/p',
                        hook: async context => {
                            contexts.push(context);
                        },
                    },
                ],
            },
        );

        expect(exitCode).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(contexts[0].outcome).toBe('repaired');
        expect(contexts[0].session).toBeUndefined();
    });

    it('does not offer a login to a Console that is not an official one', async () => {
        const root = vendureProject();
        const contexts: ConsoleLinkContext[] = [];
        const openedUrls: string[] = [];
        const messages: string[] = [];

        const exitCode = await consoleCommand(
            'link',
            {},
            {
                ...baseDependencies(root, messages),
                env: {
                    VENDURE_CLI_NON_INTERACTIVE: 'true',
                    VENDURE_CONSOLE_LINK_URL: 'http://localhost:3000',
                    VENDURE_CONSOLE_LINK_API_URL: 'http://localhost:3001',
                },
                fetch: consoleFetch({}) as unknown as typeof fetch,
                hooks: [
                    {
                        pluginId: '@example/p',
                        hook: async context => {
                            contexts.push(context);
                        },
                    },
                ],
                openUrl: async url => {
                    openedUrls.push(url);
                },
            },
        );

        expect(exitCode).toBe(0);
        expect(contexts[0].endpoints.official).toBeUndefined();
        expect(contexts[0].session).toBeUndefined();
        // No callback address was ever advertised to a Console we do not know.
        expect(new URL(openedUrls[0]).searchParams.get('redirect_uri')).toBeNull();
        // And no capability complaint, because the origin decided it first.
        expect(messages.join('\n')).not.toContain('does not settle a command line login');
    });
});

interface RunOptions {
    supports?: string[];
    tokenStatus?: number;
    openUrl?: (url: string) => Promise<void>;
}

/**
 * Drives `vendure console link` against an in-memory Console.
 *
 * The default `openUrl` is the browser: it follows the approval by calling the
 * loopback address the client advertised, which is what Console's `redirectTo`
 * makes the real browser do.
 */
async function runLink(options: RunOptions = {}) {
    const root = vendureProject();
    const openedUrls: string[] = [];
    const messages: string[] = [];
    const sessions: Array<ConsoleSession | undefined> = [];
    const grants: Array<Record<string, string>> = [];

    const fetchMock = consoleFetch({
        supports: options.supports ?? ['cli-auth'],
        tokenStatus: options.tokenStatus ?? 200,
        grants,
    });

    const exitCode = await consoleCommand(
        'link',
        {},
        {
            ...baseDependencies(root, messages),
            env: OFFICIAL_ENV,
            fetch: fetchMock as unknown as typeof fetch,
            hooks: [
                {
                    pluginId: '@example/p',
                    hook: async context => {
                        sessions.push(context.session);
                    },
                },
            ],
            openUrl: async url => {
                openedUrls.push(url);
                if (options.openUrl) {
                    await options.openUrl(url);
                    return;
                }
                // The browser: follow the approval to the address the client
                // advertised, which is what Console's `redirectTo` makes it do.
                const search = new URL(url).searchParams;
                const redirectUri = search.get('redirect_uri');
                const state = search.get('state');
                if (redirectUri && state) {
                    await fetch(`${redirectUri}?code=the-code&state=${encodeURIComponent(state)}`);
                }
            },
        },
    );

    return { exitCode, root, openedUrls, messages, sessions, grant: grants[0] ?? {}, grants };
}

function consoleFetch(options: {
    supports?: string[];
    tokenStatus?: number;
    grants?: Array<Record<string, string>>;
}) {
    return vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input);
        if (url.pathname === '/v1/project-links') {
            return jsonResponse({
                id: LINK_ID,
                state: 'pending',
                protocolVersion: 1,
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
                pollingSecret: POLLING_SECRET,
                verificationPath: `/?link=${LINK_ID}`,
                ...(options.supports ? { supports: options.supports } : {}),
            });
        }
        if (url.pathname.endsWith('/poll')) {
            return jsonResponse({
                state: 'approved',
                expiresAt: new Date(Date.now() + 600_000).toISOString(),
                manifest,
            });
        }
        if (url.pathname === '/v1/auth/cli/token') {
            options.grants?.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, string>);
            if ((options.tokenStatus ?? 200) !== 200) {
                return new Response('{}', { status: options.tokenStatus });
            }
            return jsonResponse({
                access_token: ACCESS_TOKEN,
                token_type: 'Bearer',
                expires_in: 3600,
                refresh_token: REFRESH_TOKEN,
            });
        }
        throw new Error(`Unexpected request to ${input}`);
    });
}

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function baseDependencies(root: string, messages: string[] = []): Partial<ConsoleCommandDependencies> {
    const reporter: ConsoleReporter = {
        error: message => messages.push(message),
        info: message => messages.push(message),
        success: message => messages.push(message),
        warn: message => messages.push(message),
        url: value => messages.push(value),
    };
    return {
        cwd: root,
        hooks: [],
        isNonInteractive: () => true,
        now: () => Date.now(),
        openUrl: () => Promise.resolve(),
        prompt: () => Promise.resolve(true),
        reporter,
        sleep: () => Promise.resolve(),
    };
}

function vendureProject(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-login-')));
    temporaryDirectories.push(root);
    fs.writeJsonSync(path.join(root, 'package.json'), { dependencies: { '@vendure/core': '3.7.2' } });
    return root;
}
