import { describe, expect, it, vi } from 'vitest';

import { Middleware } from './common/types/common-types';
import { isGlobalRoute, wrapEarlyMiddlewareHandler } from './wrap-early-middleware-handler';

/**
 * Reproduces the shape of body-parser's `json()`/`urlencoded()` return values, whose function
 * names (`jsonParser`/`urlencodedParser`) are what NestJS's ExpressAdapter checks for.
 */
function makeParser(name: 'jsonParser' | 'urlencodedParser') {
    const fn = vi.fn();
    Object.defineProperty(fn, 'name', { value: name });
    return fn;
}

// https://github.com/vendurehq/vendure/issues/5028
describe('wrapEarlyMiddlewareHandler', () => {
    it('wraps a route-scoped jsonParser so its name no longer collides', () => {
        const handler = makeParser('jsonParser');
        const mid: Middleware = { handler, route: '/admin-api', beforeListen: true };

        const wrapped = wrapEarlyMiddlewareHandler(mid);

        expect(wrapped).not.toBe(handler);
        expect((wrapped as any).name).not.toBe('jsonParser');
    });

    it('wraps a route-scoped urlencodedParser', () => {
        const handler = makeParser('urlencodedParser');
        const mid: Middleware = { handler, route: '/admin-api', beforeListen: true };

        expect(wrapEarlyMiddlewareHandler(mid)).not.toBe(handler);
    });

    it('the wrapped handler delegates to the original with the same arguments', () => {
        const handler = makeParser('jsonParser');
        const mid: Middleware = { handler, route: '/admin-api', beforeListen: true };
        const wrapped = wrapEarlyMiddlewareHandler(mid) as (...args: any[]) => void;

        const req = {} as any;
        const res = {} as any;
        const next = vi.fn();
        wrapped(req, res, next);

        expect(handler).toHaveBeenCalledWith(req, res, next);
    });

    it.each(['/', '', '*', '*splat', '/*splat', '{*splat}', '/{*splat}', '(.*)', '/(.*)'])(
        'leaves a parser on the catch-all route "%s" untouched (preserves global-parser replacement)',
        route => {
            const handler = makeParser('jsonParser');
            const mid: Middleware = { handler, route, beforeListen: true };

            expect(wrapEarlyMiddlewareHandler(mid)).toBe(handler);
        },
    );

    it('does not wrap a handler whose name is not a parser name', () => {
        const handler = vi.fn();
        Object.defineProperty(handler, 'name', { value: 'myCustomMiddleware' });
        const mid: Middleware = { handler, route: '/admin-api', beforeListen: true };

        expect(wrapEarlyMiddlewareHandler(mid)).toBe(handler);
    });

    it('leaves a NestJS middleware class untouched (its name does not collide)', () => {
        class SomeNestMiddleware {}
        const mid: Middleware = { handler: SomeNestMiddleware, route: '/admin-api', beforeListen: true };

        expect(wrapEarlyMiddlewareHandler(mid)).toBe(SomeNestMiddleware);
    });
});

describe('isGlobalRoute', () => {
    it.each(['/', '', '  ', '*', '/*', '*splat', '/*splat', '{*splat}', '/{*splat}', '(.*)', '/(.*)'])(
        'treats "%s" as global',
        route => {
            expect(isGlobalRoute(route)).toBe(true);
        },
    );

    it.each(['/admin-api', '/shop-api', '/webhooks/stripe', '/api/*', '/admin'])(
        'treats "%s" as scoped',
        route => {
            expect(isGlobalRoute(route)).toBe(false);
        },
    );
});
