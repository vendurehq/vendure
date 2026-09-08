import { createHash, randomBytes } from 'node:crypto';
import { Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';

import { nonEmptyString, objectValue } from './project-link-validation';

/**
 * The capability a Console advertises when a Project Link approval can also
 * settle a command line login. A Console that does not name it approves the
 * link only, and this CLI then asks for no login at all.
 */
export const CLI_AUTH_CAPABILITY = 'cli-auth';

/**
 * The tools Console names on the approval page. This CLI is always `cli`;
 * `create` is the same exchange driven by `@vendure-platform/create`, and is
 * named here so one conformance fixture can cover both halves of the contract.
 */
export type CliAuthClient = 'cli' | 'create';

/**
 * Where the exchange happens. The same route `@vendure-platform/create`
 * already uses, with the same grants and the same field names: one exchange
 * with one spelling, rather than a second dialect against one Console.
 */
export const CLI_TOKEN_PATH = '/v1/auth/cli/token';

/**
 * The path the loopback listener answers on. Console refuses a callback
 * carrying a query or a fragment and permits a path, so this carries nothing
 * but what Console appends.
 */
const CALLBACK_PATH = '/auth/callback';

/**
 * A Console CLI Session, as the token route issued it.
 *
 * The CLI does not write this anywhere. It is handed to the plugin hook that
 * asked for it, and storing it is that plugin's to do, under its own rules.
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
    client?: CliAuthClient;
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
 * `127.0.0.1` rather than `localhost`, because that is what Console's redirect
 * check is given today and a name that resolves elsewhere is not a loopback.
 * Port 0, so the operating system picks one that is free, and it is bound
 * before the browser opens so the address in the approval request is already
 * listening.
 */
export async function startLoopbackCallback(expectedState: string): Promise<LoopbackCallback> {
    let settle: ((code: string | undefined) => void) | undefined;
    const received = new Promise<string | undefined>(resolve => {
        settle = resolve;
    });

    const server: Server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== CALLBACK_PATH) {
            response.writeHead(404).end();
            return;
        }
        // Anything on this port that does not carry the state this run
        // generated is not the browser we sent. Answer it and keep waiting.
        if (url.searchParams.get('state') !== expectedState) {
            response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Unexpected login callback.\n');
            return;
        }
        const code = url.searchParams.get('code') ?? undefined;
        response.writeHead(200, { 'Content-Type': 'text/plain' }).end(
            code
                ? 'Signed in. You can close this tab and return to your terminal.\n'
                : 'The command line login was refused. You can close this tab.\n',
        );
        settle?.(code);
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;

    return {
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        code: () => received,
        close: () => {
            // Unblock anything waiting before the socket goes, so closing is
            // never the reason a caller hangs.
            settle?.(undefined);
            server.closeAllConnections();
            server.close();
        },
    };
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
    if (typeof object.expires_in !== 'number' || !Number.isFinite(object.expires_in)) {
        throw new Error('Console returned an invalid token lifetime.');
    }
    const refreshToken =
        typeof object.refresh_token === 'string' && object.refresh_token.length > 0
            ? object.refresh_token
            : undefined;
    return { accessToken, refreshToken, expiresAt: now + object.expires_in * 1000 };
}
