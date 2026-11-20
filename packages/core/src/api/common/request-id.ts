import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * The header from which an inbound request ID is read, and on which the response returns it.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * An inbound ID is accepted only when it matches this pattern, so that it is safe to write to
 * logs and response headers. Any other value is replaced with a generated ID.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const REQUEST_ID_KEY = Symbol('REQUEST_ID_KEY');

interface RequestIdStore {
    requestId: string;
}

const requestIdStorage = new AsyncLocalStorage<RequestIdStore>();

/**
 * @description
 * Returns the ID of the API request which the current code is running for, or `undefined` outside
 * a request.
 *
 * Every request gets an ID. It is taken from the `x-request-id` request header when that is a short
 * string of safe characters (letters, digits, `.`, `_`, `:` and `-`, at most 128 of them), and is
 * otherwise generated. The response returns it in the `x-request-id` header.
 *
 * While a worker processes a {@link Job}, this returns the ID of the request which added the job.
 * The same ID is available as `ctx.requestId` on the {@link RequestContext}. A custom
 * {@link VendureLogger} can call this function to add the ID to its log lines.
 *
 * @example
 * ```ts
 * import { getRequestId, VendureLogger } from '\@vendure/core';
 *
 * export class MyLogger implements VendureLogger {
 *     info(message: string, context?: string) {
 *         myLogService.write({ level: 'info', message, context, requestId: getRequestId() });
 *     }
 *     // ...
 * }
 * ```
 *
 * @docsCategory Logger
 * @since 4.0.0
 */
export function getRequestId(): string | undefined {
    return requestIdStorage.getStore()?.requestId;
}

/**
 * Runs the function with the given request ID as the current one. With no ID, the function runs
 * with no current request ID, even when it is called during a request.
 *
 * @internal
 */
export function runWithRequestId<T>(requestId: string | undefined, fn: () => T): T {
    if (requestId === undefined) {
        return requestIdStorage.exit(fn);
    }
    return requestIdStorage.run({ requestId }, fn);
}

/**
 * Returns the inbound request ID when it is safe to use, and otherwise a new one.
 *
 * @internal
 */
export function resolveRequestId(inbound: unknown): string {
    return typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();
}

/**
 * Returns the ID which the request ID middleware gave the request.
 *
 * @internal
 */
export function getRequestIdOfRequest(req: Request | undefined): string | undefined {
    return (req as (Request & { [REQUEST_ID_KEY]?: string }) | undefined)?.[REQUEST_ID_KEY];
}

/**
 * Gives every request an ID and runs the rest of the request with it as the current request ID.
 * The ID is also stored on the request, for code which runs after a library has lost the
 * asynchronous context.
 *
 * @internal
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    (req as Request & { [REQUEST_ID_KEY]?: string })[REQUEST_ID_KEY] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    requestIdStorage.run({ requestId }, next);
}
