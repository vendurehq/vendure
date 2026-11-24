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
 * The errors of {@link resolveLocalAdminTarget} and {@link sendLocalAdminRequest}. A command that
 * uses them lists {@link localAdminApiErrorList} in its `errors`.
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
    endpointUnknown: defineError<{ endpoint: LocalAdminEndpoint }>({
        code: 'devserver.endpoint-unknown',
        exit: 1,
        message: ({ endpoint }) =>
            endpoint === 'mcp-admin'
                ? 'The vendure dev run has not reported an MCP admin endpoint. The McpPlugin may not be installed.'
                : 'The vendure dev run has not reported the URL of its Admin API.',
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
            `The dev server reported ${url}, which is not a loopback address, so the local credential is not sent to it.`,
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

/** Every error in {@link localAdminApiErrors}, for a command's `errors`. */
export const localAdminApiErrorList = Object.values(localAdminApiErrors);

/** Where to send a local Admin request, and the credential to send. */
export interface LocalAdminTarget {
    url: string;
    /** The per-run secret. Never put it in output, logs or errors. */
    secret: string;
    state: DevServerState;
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
    const state = readDevServerState(projectDir);
    if (!state || !isDevRunAlive(state)) {
        return fail(localAdminApiErrors.notRunning, {});
    }
    if (state.status !== 'ready') {
        return fail(localAdminApiErrors.notReady, { status: state.status });
    }
    const url = endpoint === 'mcp-admin' ? state.urls.mcp : state.urls.admin;
    if (!url) {
        return fail(localAdminApiErrors.endpointUnknown, { endpoint });
    }
    if (!isLoopbackUrl(url)) {
        return fail(localAdminApiErrors.endpointNotLocal, { url });
    }
    return { url, secret: state.secret, state };
}

export interface LocalAdminRequestOptions {
    signal?: AbortSignal;
    /** Extra headers, such as `vendure-token`. The helper always sets `Authorization` and `Content-Type`. */
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
 * This is the one place the CLI sends the secret. For a GraphQL operation on the Admin API, use
 * {@link localAdminGraphql}.
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
    const headers = new Headers(options.headers);
    if (!headers.has('accept')) {
        // Streamable HTTP MCP answers with JSON or an event stream, and needs both accepted.
        headers.set(
            'accept',
            endpoint === 'mcp-admin' ? 'application/json, text/event-stream' : 'application/json',
        );
    }
    headers.set('content-type', 'application/json');
    headers.set('authorization', `Bearer ${target.secret}`);
    const doFetch = options.fetch ?? globalThis.fetch;
    try {
        return await doFetch(target.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            // A redirect could carry the credential to another URL.
            redirect: 'error',
            signal: options.signal,
        });
    } catch (e: unknown) {
        if (options.signal?.aborted) {
            throw e;
        }
        return fail(localAdminApiErrors.unreachable, { url: target.url, message: describeFetchError(e) });
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
    operation: { query: string; variables?: Record<string, unknown>; operationName?: string },
    options: LocalAdminRequestOptions = {},
): Promise<GraphqlResponse<Data> | ErrorResult> {
    const response = await sendLocalAdminRequest(projectDir, 'admin-api', operation, options);
    if (!(response instanceof Response)) {
        return response;
    }
    return readGraphqlResponse<Data>(response);
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

function isLoopbackUrl(url: string): boolean {
    let hostname: string;
    try {
        hostname = new URL(url).hostname;
    } catch {
        return false;
    }
    const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return bare === 'localhost' || bare === '::1' || /^127(\.\d{1,3}){3}$/.test(bare);
}

function describeFetchError(e: unknown): string {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    if (cause?.code) {
        return cause.code;
    }
    return cause?.message ?? (e instanceof Error ? e.message : String(e));
}
