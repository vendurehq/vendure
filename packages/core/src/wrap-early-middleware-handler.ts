import { NextFunction, Request, Response } from 'express';

import { Middleware, MiddlewareHandler } from './common/types/common-types';

type RequestHandlerLike = (req: Request, res: Response, next: NextFunction) => void;

/**
 * The names NestJS's `ExpressAdapter` looks for when deciding whether a global body-parser is
 * already present on the middleware stack. Its `isMiddlewareApplied()` check matches purely on the
 * handler function's name and ignores the mount path, and the `json()`/`urlencoded()` functions
 * from body-parser (used by `express.json()` and friends) are named exactly these.
 */
const NEST_PARSER_MIDDLEWARE_NAMES = ['jsonParser', 'urlencodedParser'];

/**
 * @description
 * Returns the handler to mount for a `beforeListen` middleware, guarding against a NestJS quirk that
 * would otherwise silently disable body parsing on unrelated routes.
 *
 * A `beforeListen` middleware is mounted on Express before NestJS initialises. If that handler is a
 * body-parser (`json()`/`urlencoded()`) scoped to a specific route, its function name collides with
 * the names NestJS checks when deciding whether a global parser is already registered. NestJS then
 * skips registering its own global parser, leaving every other route without body parsing. To avoid
 * this we wrap the handler in a differently-named function so NestJS registers its global parsers as
 * normal; the route-scoped parser still runs first on its own route.
 *
 * Handlers mounted on a global/catch-all route are returned unchanged, preserving the documented
 * pattern of intentionally replacing the global parser (for example to raise the request body size
 * limit).
 */
export function wrapEarlyMiddlewareHandler(mid: Middleware): MiddlewareHandler {
    const { handler, route } = mid;
    const collidesWithNestParserName =
        typeof handler === 'function' && NEST_PARSER_MIDDLEWARE_NAMES.includes(handler.name);
    if (collidesWithNestParserName && !isGlobalRoute(route)) {
        const parserHandler = handler as RequestHandlerLike;
        const scopedHandler: RequestHandlerLike = (req, res, next) => parserHandler(req, res, next);
        return scopedHandler;
    }
    return handler;
}

/**
 * @description
 * A route counts as "global" when it matches every path: the root path or a bare wildcard/splat.
 * Middleware on such a route is deliberately replacing the global body parser, so it is left
 * untouched.
 */
export function isGlobalRoute(route: string): boolean {
    const normalized = (route ?? '').trim();
    if (normalized === '' || normalized === '/') {
        return true;
    }
    const withoutLeadingSlash = normalized.replace(/^\//, '');
    // Express 5 named wildcards (`*splat`, `{*splat}`), the legacy `*`, and the regexp catch-all `(.*)`.
    return (
        /^\*\w*$/.test(withoutLeadingSlash) ||
        /^\{\*\w*\}$/.test(withoutLeadingSlash) ||
        withoutLeadingSlash === '(.*)'
    );
}
