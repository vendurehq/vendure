import { beforeEach, describe, expect, it } from 'vitest';

import { RequestContext } from '../api';

import { RequestContextCacheService } from './request-context-cache.service';

describe('Request context cache', () => {
    let cache: RequestContextCacheService;
    beforeEach(() => {
        cache = new RequestContextCacheService();
    });

    it('stores and retrieves a multiple values', () => {
        const ctx = RequestContext.empty();

        cache.set(ctx, 'test', 1);
        cache.set(ctx, 'test2', 2);
        expect(cache.get(ctx, 'test')).toBe(1);
        expect(cache.get(ctx, 'test2')).toBe(2);
    });

    it('uses getDefault function', async () => {
        const ctx = RequestContext.empty();
        const result = cache.get(ctx, 'test', async () => 'foo');

        expect(result instanceof Promise).toBe(true);
        expect(await result).toBe('foo');
    });

    it('can use objects as keys', () => {
        const ctx = RequestContext.empty();

        const x = {};
        cache.set(ctx, x, 1);
        expect(cache.get(ctx, x)).toBe(1);
    });

    it('uses separate stores per context', () => {
        const ctx = RequestContext.empty();
        const ctx2 = RequestContext.empty();

        cache.set(ctx, 'test', 1);
        cache.set(ctx2, 'test', 2);

        expect(cache.get(ctx, 'test')).toBe(1);
        expect(cache.get(ctx2, 'test')).toBe(2);
    });
});
