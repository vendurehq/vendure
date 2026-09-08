import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleSession } from './cli-auth';
import { ConsoleCommandDependencies, ConsoleReporter, consoleCommand } from './console';
import { ConsoleLinkContext } from './console-link-hook';
import { LINK_ID, NOW, POLLING_SECRET, manifest } from './console.fixtures';
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
        // The state on the URL is the one the listener accepted: the browser
        // stub only reaches the code path by echoing it back.
        expect(opened.searchParams.get('state')).toBe(test.callbackState);
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
            { accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, expiresAt: NOW + 3_600_000 },
        ]);
    });

    it('waits briefly for a callback the poll beat, rather than closing on it', async () => {
        let releaseCallback: (() => void) | undefined;
        const arrived = new Promise<void>(resolve => {
            releaseCallback = resolve;
        });
        const test = await runLink({
            // The browser has not answered by the time the poll returns, which
            // is the ordinary case: the poll runs on its own clock.
            openUrl: async url => {
                const search = new URL(url).searchParams;
                const redirectUri = search.get('redirect_uri') ?? '';
                const state = search.get('state') ?? '';
                void (async () => {
                    await fetch(`${redirectUri}?code=the-code&state=${encodeURIComponent(state)}`);
                    releaseCallback?.();
                })();
            },
            // The grace period is where the callback lands.
            sleep: async milliseconds => {
                if (milliseconds === 2_000) {
                    await arrived;
                }
            },
        });

        expect(test.delays).toContain(2_000);
        expect(test.sessions[0]?.accessToken).toBe(ACCESS_TOKEN);
    });

    it('gives up on the callback once the grace period is spent', async () => {
        const test = await runLink({ openUrl: () => Promise.resolve() });

        // Waited, then stopped waiting. The link is what the command owed.
        expect(test.delays).toContain(2_000);
        expect(test.sessions).toEqual([undefined]);
    });

    it('obtains no session when no plugin asked for one', async () => {
        const test = await runLink({ hooks: [] });

        expect(test.exitCode).toBe(0);
        // A token nobody consumes is still a live token, so none is minted and
        // no callback address is advertised.
        expect(new URL(test.openedUrls[0]).searchParams.get('redirect_uri')).toBeNull();
        expect(test.grants).toEqual([]);
    });

    it('does not advertise a callback address over an SSH session', async () => {
        const test = await runLink({ env: { ...OFFICIAL_ENV, SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22' } });

        expect(test.exitCode).toBe(0);
        // The browser is somewhere else, so the callback could only reach a
        // process that happens to hold that port on the other machine.
        expect(new URL(test.openedUrls[0]).searchParams.get('redirect_uri')).toBeNull();
        expect(test.sessions).toEqual([undefined]);
        expect(test.messages.join('\n')).toContain('will not obtain a Console session');
    });

    it('keeps the link when the token response is malformed', async () => {
        const test = await runLink({ tokenBody: { access_token: 'vcli_a', token_type: 'Bearer' } });

        expect(test.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(test.root))).toEqual(manifest);
        expect(test.sessions).toEqual([undefined]);
        expect(test.messages.join('\n')).toContain('could not be obtained');
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
        const output = test.messages.join('\n');
        expect(output).toContain('The link is in place.');
        // Re-running runs the plugin setup again, which is where a plugin that
        // needs a session signs in. The command itself cannot mint one.
        expect(output).toContain('vendure console link again');
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
    tokenBody?: unknown;
    hooks?: ConsoleCommandDependencies['hooks'];
    env?: NodeJS.ProcessEnv;
    openUrl?: (url: string) => Promise<void>;
    /** Called with each requested delay, so the grace period is observable. */
    sleep?: (milliseconds: number) => Promise<void>;
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
    const callbackStates: string[] = [];

    const fetchMock = consoleFetch({
        supports: options.supports ?? ['cli-auth'],
        tokenStatus: options.tokenStatus ?? 200,
        tokenBody: options.tokenBody,
        grants,
    });

    const delays: number[] = [];
    const exitCode = await consoleCommand(
        'link',
        {},
        {
            ...baseDependencies(root, messages),
            env: options.env ?? OFFICIAL_ENV,
            fetch: fetchMock as unknown as typeof fetch,
            now: () => NOW,
            sleep: async milliseconds => {
                delays.push(milliseconds);
                await (options.sleep?.(milliseconds) ?? Promise.resolve());
            },
            hooks: options.hooks ?? [
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
                    callbackStates.push(state);
                    await fetch(`${redirectUri}?code=the-code&state=${encodeURIComponent(state)}`);
                }
            },
        },
    );

    return {
        exitCode,
        root,
        openedUrls,
        messages,
        sessions,
        delays,
        callbackState: callbackStates[0],
        grant: grants[0] ?? {},
        grants,
    };
}

function consoleFetch(options: {
    supports?: string[];
    tokenStatus?: number;
    tokenBody?: unknown;
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
            return jsonResponse(
                options.tokenBody ?? {
                    access_token: ACCESS_TOKEN,
                    token_type: 'Bearer',
                    expires_in: 3600,
                    refresh_token: REFRESH_TOKEN,
                },
            );
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
        now: () => NOW,
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
