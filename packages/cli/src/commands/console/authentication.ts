import { ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';

import { DEFAULT_CONSOLE_API_URL, DEFAULT_CONSOLE_URL, trustedConsoleOrigins } from './console-origins';
import { nonEmptyString, objectValue } from './project-link-validation';

/** Options for standalone Console login. Core does not store the returned session. */
export interface ConsoleBrowserLoginOptions {
    client: 'cli' | 'create';
    appOrigin?: string;
    apiOrigin?: string;
    signal?: AbortSignal;
    /** Callback deadline in milliseconds. Defaults to five minutes. */
    timeoutMs?: number;
    openBrowser?: (url: string) => Promise<boolean>;
    reportAuthorizationUrl?: (url: string) => void;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
}

export interface ConsoleRefreshOptions {
    apiOrigin?: string;
    signal?: AbortSignal;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
}

/** A failed grant. Only a definitive Console grant rejection sets refused. */
export class ConsoleTokenGrantError extends Error {
    constructor(
        message: string,
        readonly refused: boolean,
    ) {
        super(message);
        this.name = 'ConsoleTokenGrantError';
    }
}

/** Sign in without starting a Project Link flow. @since 3.8.0 */
export async function loginWithBrowser(options: ConsoleBrowserLoginOptions): Promise<ConsoleSession> {
    const origins = trustedConsoleOrigins({
        appOrigin: options.appOrigin ?? DEFAULT_CONSOLE_URL,
        apiOrigin: options.apiOrigin ?? DEFAULT_CONSOLE_API_URL,
    });
    if (!['cli', 'create'].includes(options.client)) throw new Error('Unknown Console login client.');
    const timeoutMs = options.timeoutMs ?? 300_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
        throw new Error('Invalid login timeout.');
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const state = createLoginState();
    const callback = await startLoopbackCallback(state, true);
    const deadline = requestDeadline(options.signal, timeoutMs);
    let finished = false;
    try {
        deadline.signal.throwIfAborted();
        const { verifier, challenge } = createPkceChallenge();
        const url = new URL('/cli-auth', origins.appOrigin);
        for (const [key, value] of Object.entries(
            cliAuthSearchParams({
                redirectUri: callback.redirectUri,
                state,
                challenge,
                client: options.client,
            }),
        ))
            url.searchParams.set(key, value);
        const authorizationUrl = url.toString();
        const browser = Promise.resolve()
            .then(() => (options.openBrowser ?? openAuthenticationBrowser)(authorizationUrl))
            .catch(() => false)
            .then(opened => {
                if (!opened && !finished) {
                    (options.reportAuthorizationUrl ?? (value => process.stdout.write(`${value}\n`)))(
                        authorizationUrl,
                    );
                }
            });
        const code = await abortable(
            Promise.race([callback.code(), browser.then(() => callback.code())]),
            deadline.signal,
        ).catch(error => {
            if (deadline.timedOut()) throw new Error('Console login timed out.');
            throw error;
        });
        if (!code) throw new Error('Vendure Console did not authorize the login.');
        finished = true;
        deadline.dispose();
        callback.close();
        return await exchangeConsoleCode(
            { code, verifier, redirectUri: callback.redirectUri },
            {
                ...options,
                apiOrigin: origins.apiOrigin,
            },
        );
    } finally {
        finished = true;
        deadline.dispose();
        callback.close();
    }
}

/** Refresh a session and retain the old refresh token if Console does not rotate it. @since 3.8.0 */
export async function refreshSession(
    refreshToken: string,
    options: ConsoleRefreshOptions = {},
): Promise<ConsoleSession> {
    nonEmptyString(refreshToken, 'Invalid Console refresh token.');
    const session = await tokenSession({ grant_type: 'refresh_token', refresh_token: refreshToken }, options);
    return { ...session, refreshToken: session.refreshToken ?? refreshToken };
}

/** Internal exchange for standalone login. */
export function exchangeConsoleCode(
    input: { code: string; verifier: string; redirectUri: string },
    options: ConsoleRefreshOptions,
): Promise<ConsoleSession> {
    return tokenSession(authorizationCodeGrant(input), options);
}

function trustedApiOrigin(value: string): string {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    let appOrigin = DEFAULT_CONSOLE_URL;
    if (loopback) {
        appOrigin = url.origin;
    } else if (url.hostname === 'staging.api.vendure.io') {
        appOrigin = 'https://staging.console.vendure.io';
    }
    return trustedConsoleOrigins({
        appOrigin,
        apiOrigin: value,
    }).apiOrigin;
}

async function tokenSession(
    grant: Record<string, string>,
    options: ConsoleRefreshOptions,
): Promise<ConsoleSession> {
    const apiOrigin = trustedApiOrigin(options.apiOrigin ?? DEFAULT_CONSOLE_API_URL);
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const issuedAt = (options.now ?? Date.now)();
    const deadline = requestDeadline(options.signal, 10_000);
    try {
        const response = await abortable(
            (options.fetch ?? globalThis.fetch)(`${apiOrigin}${CLI_TOKEN_PATH}`, {
                method: 'POST',
                redirect: 'error',
                signal: deadline.signal,
                headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(grant),
            }),
            deadline.signal,
        );
        const body: unknown = JSON.parse(await readTokenBody(response, deadline.signal));
        if (!response.ok) {
            const refused =
                response.status >= 400 &&
                response.status < 500 &&
                body !== null &&
                typeof body === 'object' &&
                'code' in body &&
                body.code === 'cli_session.invalid_grant';
            throw new ConsoleTokenGrantError(
                `Vendure Console rejected the token request with HTTP ${response.status}.`,
                refused,
            );
        }
        return parseConsoleSession(body, issuedAt);
    } catch (error) {
        if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        if (error instanceof ConsoleTokenGrantError) throw error;
        throw new ConsoleTokenGrantError(
            deadline.timedOut()
                ? 'The Console token request timed out.'
                : 'Could not obtain a valid Console token response.',
            false,
        );
    } finally {
        deadline.dispose();
    }
}

async function readTokenBody(response: Response, signal: AbortSignal): Promise<string> {
    const limit = 64 * 1024;
    if (!response.body) {
        const text = await abortable(response.text(), signal);
        if (Buffer.byteLength(text) > limit)
            throw new Error('Console token response exceeded the maximum size.');
        return text;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await abortable(reader.read(), signal);
            if (done) return Buffer.concat(chunks).toString('utf8');
            size += value.byteLength;
            if (size > limit) throw new Error('Console token response exceeded the maximum size.');
            chunks.push(value);
        }
    } finally {
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

function requestDeadline(signal: AbortSignal | undefined, timeoutMs: number) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(() => {
        timedOut = true;
        abort();
    }, timeoutMs);
    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        dispose: () => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abort);
        },
    };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener('abort', abort);
                resolve(value);
            },
            error => {
                signal.removeEventListener('abort', abort);
                reject(error);
            },
        );
        if (signal.aborted) abort();
    });
}

function openAuthenticationBrowser(url: string): Promise<boolean> {
    return openConsoleBrowser(url).then(
        () => true,
        () => false,
    );
}

/** Internal browser opener shared with the device login of `vendure auth` and `vendure console`. */
export function openConsoleBrowser(url: string): Promise<void> {
    const windows = process.platform === 'win32';
    let command = 'xdg-open';
    if (windows) {
        command = 'rundll32';
    } else if (process.platform === 'darwin') {
        command = 'open';
    }
    const args = windows ? ['url.dll,FileProtocolHandler', url] : [url];
    return new Promise((resolve, reject) => {
        let child: ChildProcess;
        try {
            child = spawn(command, args, { detached: true, stdio: 'ignore' });
        } catch (error) {
            reject(error);
            return;
        }
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
}

/**
 * Console's CLI session token route, where an authorization code is exchanged.
 *
 * The route, the grant types and the field names are Console's, so every
 * client of it speaks the same exchange rather than a dialect of its own.
 */
export const CLI_TOKEN_PATH = '/v1/auth/cli/token';

/**
 * The path the loopback listener answers on. Console refuses a callback
 * carrying a query or a fragment and permits a path, so this carries nothing
 * but what Console appends.
 */
const CALLBACK_PATH = '/auth/callback';

/**
 * The callback URL carries a live authorization code, so the answer to it must
 * not be stored anywhere a later reader can find it.
 */
const NO_STORE = { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' };

/** Console issues one-hour sessions. Refuse implausibly long token lifetimes. */
const MAX_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

/**
 * A Console CLI Session, as the token route issued it, or the `vendure auth`
 * login's access token that `vendure console link` gives a hook that requested
 * a session. That second kind has no `refreshToken`.
 *
 * The CLI does not write this anywhere. Storing it is the plugin's to do, under
 * its own rules.
 *
 * @since 3.8.0
 */
export interface ConsoleSession {
    accessToken: string;
    refreshToken?: string;
    /** Epoch milliseconds. */
    expiresAt: number;
}

export interface PkceChallenge {
    verifier: string;
    challenge: string;
}

export function createPkceChallenge(): PkceChallenge {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function createLoginState(): string {
    return randomBytes(16).toString('base64url');
}

/**
 * The query Console reads on the approval page.
 *
 * All five or none. Console shows an error and offers no approval for a
 * partial set, which is what stops a malformed request approving the link and
 * leaving this listener waiting for a callback nobody will make.
 */
export function cliAuthSearchParams(input: {
    redirectUri: string;
    state: string;
    challenge: string;
    client?: 'cli' | 'create';
}): Record<string, string> {
    return {
        client: input.client ?? 'cli',
        redirect_uri: input.redirectUri,
        state: input.state,
        code_challenge: input.challenge,
        code_challenge_method: 'S256',
    };
}

export interface LoopbackCallback {
    /** The address Console sends the browser to. Bound before the browser opens. */
    redirectUri: string;
    /**
     * The authorization code.
     *
     * Resolves `undefined` when the login was refused, or when {@link close} is
     * called first because the browser is never going to arrive.
     */
    code(): Promise<string | undefined>;
    close(): void;
}

/**
 * Binds a one-shot callback on this machine.
 *
 * The address is `127.0.0.1` rather than `localhost`, because a name can be
 * made to resolve elsewhere. Port 0 lets the operating system pick a free one.
 * The bind happens before the browser opens, so the address in the approval
 * request is already listening when Console redirects to it.
 */
export async function startLoopbackCallback(
    expectedState: string,
    rejectInvalidState = false,
): Promise<LoopbackCallback> {
    let rejectCode: ((error: Error) => void) | undefined;
    let resolveCode: ((code: string | undefined) => void) | undefined;
    const received = new Promise<string | undefined>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });

    const server: Server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
            response.writeHead(404, NO_STORE).end();
            return;
        }
        // A mismatched state is not this login. Combined linking keeps waiting;
        // standalone login rejects so its caller can report the failure.
        if (!matchesState(url.searchParams.get('state'), expectedState)) {
            response.writeHead(400, NO_STORE).end('Unexpected login callback.\n');
            if (rejectInvalidState) rejectCode?.(new Error('Login state did not match.'));
            return;
        }
        const code = url.searchParams.has('error') ? undefined : url.searchParams.get('code') || undefined;
        response
            .writeHead(200, NO_STORE)
            .end(
                code
                    ? 'Signed in. You can close this tab and return to your terminal.\n'
                    : 'The command line login was refused. You can close this tab.\n',
            );
        resolveCode?.(code);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            // Keep a listener after binding so a later server error does not
            // terminate the process.
            server.removeListener('error', reject);
            server.on('error', () => resolveCode?.(undefined));
            resolve();
        });
    });
    const { port } = server.address() as AddressInfo;

    let closed = false;
    return {
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        code: () => received,
        close: () => {
            if (closed) {
                return;
            }
            closed = true;
            resolveCode?.(undefined);
            server.closeAllConnections();
            server.close();
        },
    };
}

/**
 * The state is this flow's CSRF nonce, so the comparison does not leak where
 * two values first differ. It does return early on a length mismatch, which is
 * harmless here because the expected value is a fixed-length local nonce.
 */
function matchesState(received: string | null, expected: string): boolean {
    if (received === null) {
        return false;
    }
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** The body the token route takes for an authorization code. */
export function authorizationCodeGrant(input: {
    code: string;
    verifier: string;
    redirectUri: string;
}): Record<string, string> {
    return {
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.verifier,
        redirect_uri: input.redirectUri,
    };
}

export function parseConsoleSession(value: unknown, now: number): ConsoleSession {
    const object = objectValue(value, 'Console returned a malformed token response.');
    const accessToken = nonEmptyString(object.access_token, 'Console returned an invalid access token.');
    if (object.token_type !== 'Bearer') {
        throw new Error('Console returned an unsupported token type.');
    }
    if (
        typeof object.expires_in !== 'number' ||
        !Number.isInteger(object.expires_in) ||
        object.expires_in <= 0 ||
        object.expires_in > MAX_TOKEN_LIFETIME_SECONDS
    ) {
        throw new Error('Console returned an invalid token lifetime.');
    }
    const refreshToken =
        object.refresh_token === undefined
            ? undefined
            : nonEmptyString(object.refresh_token, 'Console returned an invalid refresh token.');
    return { accessToken, refreshToken, expiresAt: now + object.expires_in * 1000 };
}
