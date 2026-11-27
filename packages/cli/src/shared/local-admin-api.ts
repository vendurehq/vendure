import { defineError, ErrorResult, fail, isErrorResult } from '@vendure/common/lib/command';

import {
    DevServerState,
    DevServerStatus,
    isDevRunAlive,
    readDevServerState,
} from '../commands/dev/state-file.js';

/**
 * The local endpoints that accept the per-run secret of a `vendure dev` run as a credential:
 * the Admin API, and the McpPlugin's `POST /mcp/admin`.
 */
export type LocalAdminEndpoint = 'admin-api' | 'mcp-admin';

/**
 * The errors of the functions in this module that reach the local dev server: the Admin API and
 * MCP calls with the per-run secret, and the anonymous Shop API call. A command that uses them lists
 * {@link localAdminApiErrorList} in its `errors`.
 */
export const localAdminApiErrors = {
    notRunning: defineError<Record<string, never>>({
        code: 'devserver.not-running',
        exit: 1,
        message: () => 'No vendure dev run is serving this project.',
        fix: () => [{ path: ['devserver', 'start'], input: {}, description: 'Start the dev server' }],
    }),
    notReady: defineError<{ status: DevServerStatus }>({
        code: 'devserver.not-ready',
        exit: 1,
        message: ({ status }) => `The vendure dev run serving this project is ${status}, not ready.`,
        fix: ({ status }) =>
            status === 'failed'
                ? [
                      {
                          path: ['devserver', 'status'],
                          input: {},
                          description: 'See why the dev server failed',
                      },
                  ]
                : [
                      {
                          path: ['devserver', 'wait'],
                          input: { until: 'ready' },
                          description: 'Wait until the dev server is ready',
                      },
                  ],
    }),
    endpointUnknown: defineError<{ endpoint: LocalAdminEndpoint | 'shop-api' }>({
        code: 'devserver.endpoint-unknown',
        exit: 1,
        message: ({ endpoint }) =>
            endpoint === 'mcp-admin'
                ? 'The vendure dev run has not reported an MCP admin endpoint. The McpPlugin may not be installed.'
                : `The vendure dev run has not reported the URL of its ${apiName(endpoint)}.`,
        fix: () => [
            {
                path: ['devserver', 'status'],
                input: {},
                description: 'See the URLs the dev server reported',
            },
        ],
    }),
    endpointNotLocal: defineError<{ url: string }>({
        code: 'devserver.endpoint-not-local',
        exit: 1,
        message: ({ url }) =>
            `The dev server reported ${url}, which is not a loopback address, so the local credential ` +
            'is not sent to it. Set apiOptions.hostname to localhost, 0.0.0.0 or leave it unset.',
        fix: () => [
            {
                path: ['devserver', 'status'],
                input: {},
                description: 'See the URLs the dev server reported',
            },
        ],
    }),
    unreachable: defineError<{ url: string; message: string }>({
        code: 'devserver.unreachable',
        exit: 1,
        message: ({ url, message }) => `Could not reach the dev server at ${url}: ${message}`,
        fix: () => [
            {
                path: ['devserver', 'status'],
                input: {},
                description: 'Check that the dev server is still running',
            },
        ],
    }),
};

function apiName(endpoint: LocalAdminEndpoint | 'shop-api'): string {
    return endpoint === 'shop-api' ? 'Shop API' : 'Admin API';
}

/** Every error in {@link localAdminApiErrors}, for a command's `errors`. */
export const localAdminApiErrorList = Object.values(localAdminApiErrors);

/** Where to send a local Admin request, and the credential to send. */
export interface LocalAdminTarget {
    url: string;
    /** The per-run secret. Never put it in output, logs or errors. */
    secret: string;
}

/**
 * Finds the local endpoint of the `vendure dev` run serving the project, from its state file at
 * `localTrustStatePath`. It fails when no live run is serving the project, when the run is not
 * `ready`, or when the run has not reported the endpoint.
 *
 * The project directory comes from `resolveDevServerStateProject(ctx)`.
 */
export function resolveLocalAdminTarget(
    projectDir: string,
    endpoint: LocalAdminEndpoint,
): LocalAdminTarget | ErrorResult {
    const state = readReadyState(projectDir);
    if (isErrorResult(state)) {
        return state;
    }
    return toLocalAdminTarget(state, endpoint);
}

/**
 * The local endpoint of a ready `vendure dev` run, from its state, as {@link resolveLocalAdminTarget}
 * finds it. It fails when the run has not reported the endpoint, or reported one that is not on a
 * loopback address.
 */
export function toLocalAdminTarget(
    state: DevServerState,
    endpoint: LocalAdminEndpoint,
): LocalAdminTarget | ErrorResult {
    const reported = endpoint === 'mcp-admin' ? state.urls.mcp : state.urls.admin;
    if (!reported) {
        return fail(localAdminApiErrors.endpointUnknown, { endpoint });
    }
    const url = toLoopbackUrl(reported);
    if (!url) {
        return fail(localAdminApiErrors.endpointNotLocal, { url: reported });
    }
    return { url, secret: state.secret };
}

/**
 * The Shop API URL of the `vendure dev` run serving the project, with the run checks of
 * {@link resolveLocalAdminTarget}. A Shop API call carries no credential, so a URL that is not on a
 * loopback address is used as it is; only a wildcard bind is mapped to loopback.
 */
export function resolveLocalShopApiUrl(projectDir: string): string | ErrorResult {
    const state = readReadyState(projectDir);
    if (isErrorResult(state)) {
        return state;
    }
    const reported = state.urls.shop;
    if (!reported) {
        return fail(localAdminApiErrors.endpointUnknown, { endpoint: 'shop-api' });
    }
    return toLoopbackUrl(reported) ?? reported;
}

function readReadyState(projectDir: string): DevServerState | ErrorResult {
    return checkReadyState(readDevServerState(projectDir));
}

/**
 * Checks that a state file belongs to a live `vendure dev` run that is `ready`. A caller that reads
 * the state itself, such as the `admin_*` proxy of `vendure mcp`, passes its own liveness check.
 */
export function checkReadyState(
    state: DevServerState | undefined,
    isAlive: (state: DevServerState) => boolean = isDevRunAlive,
): DevServerState | ErrorResult {
    // A run writes `stopped` just before its process exits.
    if (!state || state.status === 'stopped' || !isAlive(state)) {
        return fail(localAdminApiErrors.notRunning, {});
    }
    if (state.status !== 'ready') {
        return fail(localAdminApiErrors.notReady, { status: state.status });
    }
    return state;
}

export interface LocalAdminRequestOptions {
    signal?: AbortSignal;
    /**
     * Extra headers, such as `vendure-token`. The helper always sets `Content-Type`, and sets
     * `Authorization` on the calls that carry the per-run secret.
     */
    headers?: Record<string, string>;
    /** @default globalThis.fetch */
    fetch?: typeof fetch;
}

/**
 * POSTs a JSON body to the Admin API or to `POST /mcp/admin` of the local `vendure dev` run, with
 * the run's per-run secret as a Bearer token. The server accepts the secret only from loopback,
 * and acts as the superadmin. It returns the response as it is, or a coded error when no ready run
 * serves the project or the server cannot be reached.
 *
 * For a GraphQL operation on the Admin API, use {@link localAdminGraphql}.
 */
export async function sendLocalAdminRequest(
    projectDir: string,
    endpoint: LocalAdminEndpoint,
    body: unknown,
    options: LocalAdminRequestOptions = {},
): Promise<Response | ErrorResult> {
    const target = resolveLocalAdminTarget(projectDir, endpoint);
    if (isErrorResult(target)) {
        return target;
    }
    return sendToLocalAdminTarget(target, endpoint, body, options);
}

/**
 * POSTs a JSON body to a target that {@link resolveLocalAdminTarget} or {@link toLocalAdminTarget}
 * returned, with its per-run secret as a Bearer token. This is the one place the CLI sends the
 * secret.
 */
export async function sendToLocalAdminTarget(
    target: LocalAdminTarget,
    endpoint: LocalAdminEndpoint,
    body: unknown,
    options: LocalAdminRequestOptions = {},
): Promise<Response | ErrorResult> {
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${target.secret}`);
    return postJson(target.url, body, headers, {
        ...options,
        // Streamable HTTP MCP answers with JSON or an event stream, and needs both accepted.
        accept: endpoint === 'mcp-admin' ? 'application/json, text/event-stream' : 'application/json',
    });
}

/**
 * POSTs a JSON body, and maps a connection that fails to `devserver.unreachable`. A request the
 * caller aborted rethrows. Redirects are refused, so a credential in `headers` stays with `url`.
 */
async function postJson(
    url: string,
    body: unknown,
    headers: Headers,
    options: LocalAdminRequestOptions & { accept: string },
): Promise<Response | ErrorResult> {
    if (!headers.has('accept')) {
        headers.set('accept', options.accept);
    }
    headers.set('content-type', 'application/json');
    const doFetch = options.fetch ?? globalThis.fetch;
    try {
        return await doFetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            redirect: 'error',
            signal: options.signal,
        });
    } catch (e: unknown) {
        if (options.signal?.aborted) {
            throw e;
        }
        return fail(localAdminApiErrors.unreachable, { url, message: describeFetchError(e) });
    }
}

/** A GraphQL response, with each error's `extensions` as the server sent them. */
export interface GraphqlResponse<Data = Record<string, unknown>> {
    data?: Data | null;
    errors?: Array<{ message: string; path?: Array<string | number>; extensions?: Record<string, unknown> }>;
}

/**
 * Runs a GraphQL operation on the Admin API of the local `vendure dev` run as the superadmin,
 * through {@link sendLocalAdminRequest}. GraphQL errors are returned in `errors`, not thrown, so a
 * caller can pass their `extensions.requestId` on. A response that is not GraphQL JSON is
 * returned as one error.
 */
export async function localAdminGraphql<Data = Record<string, unknown>>(
    projectDir: string,
    operation: GraphqlOperation,
    options: LocalAdminRequestOptions = {},
): Promise<GraphqlResponse<Data> | ErrorResult> {
    const response = await sendLocalAdminRequest(projectDir, 'admin-api', operation, options);
    if (isErrorResult(response)) {
        return response;
    }
    return readResponse<Data>(response, 'the Admin API', options.signal);
}

/**
 * Runs a GraphQL operation on the Shop API of the local `vendure dev` run with no credential, the
 * same as a storefront. Each call is a new anonymous session. The result is the same as for
 * {@link localAdminGraphql}.
 */
export async function localShopGraphql<Data = Record<string, unknown>>(
    projectDir: string,
    operation: GraphqlOperation,
    options: LocalAdminRequestOptions = {},
): Promise<GraphqlResponse<Data> | ErrorResult> {
    const url = resolveLocalShopApiUrl(projectDir);
    if (isErrorResult(url)) {
        return url;
    }
    const response = await postJson(url, operation, new Headers(options.headers), {
        ...options,
        accept: 'application/json',
    });
    if (isErrorResult(response)) {
        return response;
    }
    return readResponse<Data>(response, url, options.signal);
}

/** A GraphQL operation as it is posted. */
export interface GraphqlOperation {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
}

async function readResponse<Data>(
    response: Response,
    fallbackUrl: string,
    signal: AbortSignal | undefined,
): Promise<GraphqlResponse<Data> | ErrorResult> {
    try {
        return await readGraphqlResponse<Data>(response);
    } catch (e: unknown) {
        // The connection can fail while the body arrives, after `fetch` resolved.
        if (signal?.aborted) {
            throw e;
        }
        return fail(localAdminApiErrors.unreachable, {
            url: response.url || fallbackUrl,
            message: describeFetchError(e),
        });
    }
}

/**
 * Reads a GraphQL response body. A body that is not a GraphQL result, such as an HTML error page,
 * becomes one error that names the HTTP status.
 */
export async function readGraphqlResponse<Data = Record<string, unknown>>(
    response: Response,
): Promise<GraphqlResponse<Data>> {
    const text = await response.text();
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null && ('data' in parsed || 'errors' in parsed)) {
            return parsed as GraphqlResponse<Data>;
        }
    } catch {
        // Not JSON: reported below.
    }
    const requestId = response.headers.get('x-request-id');
    return {
        errors: [
            {
                message: `The server answered HTTP ${response.status} without a GraphQL result.`,
                extensions: {
                    httpStatus: response.status,
                    ...(requestId ? { requestId } : {}),
                },
            },
        ],
    };
}

/**
 * The URL to send the credential to: the reported URL when its host is a loopback address, or the
 * same URL on 127.0.0.1 or [::1] when the server listens on every address, as with
 * `apiOptions.hostname: '0.0.0.0'`. `undefined` for any other host.
 */
export function toLoopbackUrl(reported: string): string | undefined {
    let url: URL;
    try {
        url = new URL(reported);
    } catch {
        return undefined;
    }
    const bare = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (bare === 'localhost' || bare === '::1' || /^127(\.\d{1,3}){3}$/.test(bare)) {
        return reported;
    }
    if (bare === '0.0.0.0' || bare === '::') {
        url.hostname = bare === '::' ? '[::1]' : '127.0.0.1';
        return url.toString();
    }
    return undefined;
}

function describeFetchError(e: unknown): string {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    if (cause?.code) {
        return cause.code;
    }
    return cause?.message ?? (e instanceof Error ? e.message : String(e));
}
