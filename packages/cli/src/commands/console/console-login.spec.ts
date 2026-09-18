import fs from 'fs-extra';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConsoleSession, startLoopbackCallback } from './cli-auth';
import { CALLBACK_GRACE_MS, ConsoleCommandDependencies, ConsoleReporter, consoleCommand } from './console';
import { ConsoleLinkContext } from './console-link-hook';
import {
    ACCESS_TOKEN,
    LINK_ID,
    NOW,
    REFRESH_TOKEN,
    createConsoleFetch,
    createVendureProject,
    manifest,
} from './console.fixtures';
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

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('console link command line login', () => {
    it('settles the link and the session from one browser approval', async () => {
        const run = await runLink();

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        // One approval. The browser was opened once and never sent to the
        // standalone sign-in page.
        expect(run.openedUrls).toHaveLength(1);
        expect(new URL(run.openedUrls[0]).pathname).not.toBe('/cli-auth');

        // All five parameters, on the verification URL Console already returned.
        const opened = new URL(run.openedUrls[0]);
        expect(opened.searchParams.get('client')).toBe('cli');
        expect(opened.searchParams.get('code_challenge_method')).toBe('S256');
        // The state on the URL is the one the listener accepted: the browser
        // stub only reaches the code path by echoing it back.
        expect(opened.searchParams.get('state')).toBe(run.callbackState);
        const redirectUri = opened.searchParams.get('redirect_uri') ?? '';
        expect(new URL(redirectUri).hostname).toBe('127.0.0.1');
        expect(new URL(redirectUri).pathname).toBe('/auth/callback');

        // The exchange proved possession of the verifier behind the challenge.
        expect(createHash('sha256').update(run.grant.code_verifier).digest('base64url')).toBe(
            opened.searchParams.get('code_challenge'),
        );
        expect(run.grant.grant_type).toBe('authorization_code');
        expect(run.grant.redirect_uri).toBe(redirectUri);

        expect(run.sessions).toEqual([
            { accessToken: ACCESS_TOKEN, refreshToken: REFRESH_TOKEN, expiresAt: NOW + 3_600_000 },
        ]);
    });

    it('waits briefly for a callback the poll beat, rather than closing on it', async () => {
        let releaseCallback: (() => void) | undefined;
        const arrived = new Promise<void>(resolve => {
            releaseCallback = resolve;
        });
        const run = await runLink({
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
                if (milliseconds === CALLBACK_GRACE_MS) {
                    await arrived;
                }
            },
        });

        expect(run.delays).toEqual([CALLBACK_GRACE_MS]);
        expect(run.sessions[0]?.accessToken).toBe(ACCESS_TOKEN);
    });

    it('gives up on the callback once the grace period is spent', async () => {
        const run = await runLink({ openUrl: () => Promise.resolve() });

        expect(run.delays).toEqual([CALLBACK_GRACE_MS]);
        expect(run.sessions).toEqual([undefined]);
    });

    it('cancels the losing grace delay when the callback wins', async () => {
        let graceSignal: AbortSignal | undefined;
        const run = await runLink({
            sleep: (milliseconds, signal) => {
                expect(milliseconds).toBe(CALLBACK_GRACE_MS);
                graceSignal = signal;
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('grace cancelled')), {
                        once: true,
                    });
                });
            },
        });

        expect(run.exitCode).toBe(0);
        expect(run.delays).toEqual([CALLBACK_GRACE_MS]);
        expect(graceSignal?.aborted).toBe(true);
    });

    it('obtains no session when no plugin asked for one', async () => {
        const run = await runLink({ hooks: [] });

        expect(run.exitCode).toBe(0);
        // A token nobody consumes is still a live token, so none is minted and
        // no callback address is advertised.
        expect(new URL(run.openedUrls[0]).searchParams.get('redirect_uri')).toBeNull();
        expect(run.grants).toEqual([]);
    });

    it('does not obtain or expose a session for a hook that did not request one', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({
            hooks: [
                {
                    pluginId: '@example/config-only',
                    hook: async context => {
                        sessions.push(context.session);
                    },
                },
            ],
        });

        expect(run.exitCode).toBe(0);
        expect(new URL(run.openedUrls[0]).searchParams.get('redirect_uri')).toBeNull();
        expect(run.grants).toEqual([]);
        expect(sessions).toEqual([undefined]);
    });

    it('gives each requesting hook its own session copy', async () => {
        const sessions: Array<ConsoleSession | undefined> = [];
        const run = await runLink({
            hooks: [
                {
                    pluginId: '@example/first',
                    requiresSession: true,
                    hook: async context => {
                        sessions.push(context.session);
                        if (context.session) {
                            context.session.accessToken = 'changed-by-first';
                        }
                    },
                },
                {
                    pluginId: '@example/second',
                    requiresSession: true,
                    hook: async context => {
                        sessions.push(context.session);
                    },
                },
            ],
        });

        expect(run.exitCode).toBe(0);
        expect(sessions).toHaveLength(2);
        expect(sessions[0]).not.toBe(sessions[1]);
        expect(sessions[1]?.accessToken).toBe(ACCESS_TOKEN);
    });

    it('does not advertise a callback address over an SSH session', async () => {
        const run = await runLink({ env: { ...OFFICIAL_ENV, SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22' } });

        expect(run.exitCode).toBe(0);
        // The browser is somewhere else, so the callback could only reach a
        // process that happens to hold that port on the other machine.
        expect(new URL(run.openedUrls[0]).searchParams.get('redirect_uri')).toBeNull();
        expect(run.sessions).toEqual([undefined]);
        const output = run.messages.join('\n');
        expect(output).toContain('remote shell');
        // Re-running hits the same gate, so it must not be offered as a cure.
        expect(output).not.toContain('vendure console link again');
    });

    it('keeps the link when the token response is malformed', async () => {
        const run = await runLink({ tokenBody: { access_token: 'vcli_a', token_type: 'Bearer' } });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        expect(run.sessions).toEqual([undefined]);
        expect(run.messages.join('\n')).toContain('could not be obtained');
    });

    it('links without a session when the Console does not settle a login, and says so', async () => {
        const run = await runLink({ supports: [] });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        // No login was requested, so the verification URL is the plain one.
        expect(new URL(run.openedUrls[0]).searchParams.get('client')).toBeNull();
        expect(run.sessions).toEqual([undefined]);
        expect(run.messages.join('\n')).toContain('does not settle a command line login');
    });

    it('asks for the link alone when no browser can be opened here', async () => {
        const run = await runLink({ openUrl: () => Promise.reject(new Error('no browser')) });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        // The URL offered for another machine carries no callback address,
        // because that address is only reachable from this one.
        const printed = run.messages.find(message => message.startsWith('https://'));
        expect(printed).toBeDefined();
        expect(new URL(printed ?? '').searchParams.get('redirect_uri')).toBeNull();
        expect(run.sessions).toEqual([undefined]);
        // Said before the person approves, not after.
        expect(run.messages.join('\n')).toContain('will not obtain a Console session');
    });

    it('keeps the link when the browser approved somewhere the callback cannot reach', async () => {
        // The approval happens, so the poll completes, but nothing ever calls
        // the listener on this machine.
        const run = await runLink({ openUrl: () => Promise.resolve() });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        expect(run.sessions).toEqual([undefined]);
        const output = run.messages.join('\n');
        expect(output).toContain('The link is in place.');
        // Re-running runs the plugin setup again, which is where a plugin that
        // needs a session signs in. The command itself cannot mint one.
        expect(output).toContain('vendure console link again');
    });

    it('keeps the link when the token exchange is refused', async () => {
        const run = await runLink({ tokenStatus: 400 });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        expect(run.sessions).toEqual([undefined]);
        expect(run.messages.join('\n')).toContain('could not be obtained');
    });

    it('has the manifest on disk before the login can be interrupted', async () => {
        const abort = new AbortController();
        const run = await runLink({
            // Approved in the browser, then Ctrl-C while the code is being
            // exchanged, which is the window the reorder is about.
            onTokenRequest: () => abort.abort(),
            signal: abort.signal,
        });

        expect(run.exitCode).toBe(130);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        const output = run.messages.join('\n');
        expect(output).toContain('The link succeeded');
        expect(output).not.toContain('No Project Link Manifest was changed');
    });

    it('links without a session when the callback port cannot be bound', async () => {
        const run = await runLink({
            startLoopbackCallback: vi.fn().mockRejectedValue(new Error('listen EACCES 127.0.0.1')),
        });

        expect(run.exitCode).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(run.root))).toEqual(manifest);
        expect(run.sessions).toEqual([undefined]);
        expect(run.messages.join('\n')).toContain('EACCES');
    });

    it('releases the loopback port after link returns', async () => {
        const run = await runLink();
        const redirectUri = new URL(run.openedUrls[0]).searchParams.get('redirect_uri');

        expect(redirectUri).not.toBeNull();
        await expect(fetch(redirectUri ?? '')).rejects.toThrow();
    });

    it('does not overwrite reserved authentication query parameters', async () => {
        const run = await runLink({ verificationPath: `/?link=${LINK_ID}&state=console-state` });

        const opened = new URL(run.openedUrls[0]);
        expect(opened.searchParams.get('state')).toBe('console-state');
        expect(opened.searchParams.get('redirect_uri')).toBeNull();
        expect(run.grants).toEqual([]);
        expect(run.sessions).toEqual([undefined]);
        expect(run.messages.join('\n')).toContain('reserved authentication parameter "state"');
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
                        requiresSession: true,
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
                fetch: vi.fn(createConsoleFetch()) as unknown as typeof fetch,
                hooks: [
                    {
                        pluginId: '@example/p',
                        requiresSession: true,
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
        const output = messages.join('\n');
        expect(output).toContain('not an official Vendure Console');
        expect(output).not.toContain('does not settle a command line login');
    });
});

interface RunOptions {
    supports?: string[];
    tokenStatus?: number;
    tokenBody?: unknown;
    hooks?: ConsoleCommandDependencies['hooks'];
    env?: NodeJS.ProcessEnv;
    openUrl?: (url: string) => Promise<void>;
    signal?: AbortSignal;
    onTokenRequest?: () => void;
    startLoopbackCallback?: typeof startLoopbackCallback;
    verificationPath?: string;
    /** Called with each requested delay, so the grace period is observable. */
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
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

    const fetchMock = vi.fn(
        createConsoleFetch({
            supports: options.supports ?? ['cli-auth'],
            tokenStatus: options.tokenStatus ?? 200,
            tokenBody: options.tokenBody,
            onTokenRequest: options.onTokenRequest,
            grants,
            verificationPath: options.verificationPath,
        }),
    );

    const delays: number[] = [];
    const exitCode = await consoleCommand(
        'link',
        {},
        {
            ...baseDependencies(root, messages),
            env: options.env ?? OFFICIAL_ENV,
            fetch: fetchMock as unknown as typeof fetch,
            signal: options.signal,
            now: () => NOW,
            sleep: async (milliseconds, signal) => {
                delays.push(milliseconds);
                await (options.sleep?.(milliseconds, signal) ?? Promise.resolve());
            },
            ...(options.startLoopbackCallback
                ? { startLoopbackCallback: options.startLoopbackCallback }
                : {}),
            hooks: options.hooks ?? [
                {
                    pluginId: '@example/p',
                    requiresSession: true,
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
        now: () => NOW,
        openUrl: () => Promise.resolve(),
        prompt: () => Promise.resolve(true),
        reporter,
        sleep: () => Promise.resolve(),
    };
}

function vendureProject(): string {
    return createVendureProject(temporaryDirectories, 'vendure-console-login-');
}
