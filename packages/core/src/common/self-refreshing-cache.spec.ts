import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Logger } from '../config/logger/vendure-logger';

import { createSelfRefreshingCache, SelfRefreshingCache } from './self-refreshing-cache';

describe('SelfRefreshingCache', () => {
    let testCache: SelfRefreshingCache<number, [string]>;
    const fetchFn = vi.fn().mockImplementation((arg: string) => arg.length);
    let currentTime = 0;
    beforeAll(async () => {
        testCache = await createSelfRefreshingCache<number, [string]>({
            name: 'test',
            ttl: 1000,
            refresh: {
                fn: async arg => {
                    return fetchFn(arg) as number;
                },
                defaultArgs: ['default'],
            },
            getTimeFn: () => currentTime,
        });
    });

    it('fetches value on first call', async () => {
        const result = await testCache.value();
        expect(result).toBe(7);
        expect(fetchFn.mock.calls.length).toBe(1);
    });

    it('passes default args on first call', () => {
        expect(fetchFn.mock.calls[0]).toEqual(['default']);
    });

    it('return from cache on second call', async () => {
        const result = await testCache.value();
        expect(result).toBe(7);
        expect(fetchFn.mock.calls.length).toBe(1);
    });

    it('automatically refresh after ttl expires', async () => {
        currentTime = 1001;
        const result = await testCache.value('custom');
        expect(result).toBe(6);
        expect(fetchFn.mock.calls.length).toBe(2);
    });

    it('refresh forces fetch with supplied args', async () => {
        const result = await testCache.refresh('new arg which is longer');
        expect(result).toBe(23);
        expect(fetchFn.mock.calls.length).toBe(3);
        expect(fetchFn.mock.calls[2]).toEqual(['new arg which is longer']);
    });

    describe('memoization', () => {
        const memoizedFn = vi.fn();
        let getMemoized: (arg1: string, arg2: number) => Promise<number>;

        beforeAll(() => {
            getMemoized = async (arg1, arg2) => {
                return testCache.memoize([arg1, arg2], ['quux'], async (value, a1, a2) => {
                    memoizedFn(a1, a2);
                    return value * +a2;
                });
            };
        });

        it('calls the memoized function only once for the given args', async () => {
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(23 * 1);
            expect(memoizedFn.mock.calls.length).toBe(1);
            expect(memoizedFn.mock.calls[0]).toEqual(['foo', 1]);

            const result2 = await getMemoized('foo', 1);
            expect(result2).toBe(23 * 1);
            expect(memoizedFn.mock.calls.length).toBe(1);
        });

        it('calls the memoized function when args change', async () => {
            const result1 = await getMemoized('foo', 2);
            expect(result1).toBe(23 * 2);
            expect(memoizedFn.mock.calls.length).toBe(2);
            expect(memoizedFn.mock.calls[1]).toEqual(['foo', 2]);
        });

        it('retains memoized results from earlier calls', async () => {
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(23 * 1);
            expect(memoizedFn.mock.calls.length).toBe(2);
        });

        it('re-fetches and re-runs memoized function after ttl expires', async () => {
            currentTime = 3000;
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(3);

            await getMemoized('foo', 1);
            expect(memoizedFn.mock.calls.length).toBe(3);
        });

        it('works with alternating calls', async () => {
            const result1 = await getMemoized('foo', 1);
            expect(result1).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(3);

            const result2 = await getMemoized('foo', 3);
            expect(result2).toBe(4 * 3);
            expect(memoizedFn.mock.calls.length).toBe(4);

            const result3 = await getMemoized('foo', 1);
            expect(result3).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(4);

            const result4 = await getMemoized('foo', 3);
            expect(result4).toBe(4 * 3);
            expect(memoizedFn.mock.calls.length).toBe(4);

            const result5 = await getMemoized('foo', 1);
            expect(result5).toBe(4 * 1);
            expect(memoizedFn.mock.calls.length).toBe(4);
        });
    });
});

describe('concurrent context-free refreshes', () => {
    async function setup() {
        let now = 0;
        const fetch = vi.fn(async (_context: string) => 1);
        const cache = await createSelfRefreshingCache({
            name: 'concurrent',
            ttl: 1000,
            refresh: { fn: fetch, defaultArgs: ['default'] },
            getTimeFn: () => now,
        });
        now = 1001;
        return { cache, fetch, expire: () => (now += 1001), advance: (ms: number) => (now += ms) };
    }

    it('shares a refresh across concurrent value() and value(undefined) reads', async () => {
        const { cache, fetch, expire } = await setup();
        let resolve!: (value: number) => void;
        fetch.mockImplementationOnce(() => new Promise<number>(r => (resolve = r)));
        const reads = Array.from({ length: 300 }, (_, i) => (i % 2 ? cache.value() : cache.value(undefined)));
        expect(fetch).toHaveBeenCalledTimes(2);
        resolve(2);
        expect(await Promise.all(reads)).toEqual(Array(300).fill(2));
        expect(await cache.value()).toBe(2);
        expire();
        expect(await cache.value()).toBe(1);
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('retries after a failed shared refresh', async () => {
        const { cache, fetch } = await setup();
        const log = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        try {
            fetch.mockRejectedValueOnce(new Error('database unavailable'));
            expect(await Promise.all([cache.value(), cache.value()])).toEqual([1, 1]);
            expect(fetch).toHaveBeenCalledTimes(2);
            fetch.mockResolvedValueOnce(2);
            expect(await cache.value()).toBe(2);
            expect(fetch).toHaveBeenCalledTimes(3);
        } finally {
            log.mockRestore();
        }
    });

    it('keeps explicit refreshes and transaction-specific reads independent', async () => {
        const { cache, fetch } = await setup();
        let resolve!: (value: number) => void;
        fetch.mockImplementationOnce(() => new Promise<number>(r => (resolve = r)));
        const pending = cache.value();
        const first = cache.value('transaction-a');
        const second = cache.value('transaction-b');
        const forced = cache.refresh('transaction-c');
        expect(fetch.mock.calls.map(args => args[0])).toEqual([
            'default',
            'default',
            'transaction-a',
            'transaction-b',
            'transaction-c',
        ]);
        resolve(2);
        expect(await Promise.all([pending, first, second, forced])).toEqual([2, 1, 1, 1]);
    });

    it('does not let an older read overwrite a forced refresh or extend its TTL', async () => {
        const { cache, fetch, advance } = await setup();
        let resolveOld!: (value: number) => void;
        fetch.mockImplementationOnce(() => new Promise<number>(resolve => (resolveOld = resolve)));
        const oldRead = cache.value();
        fetch.mockResolvedValueOnce(3);
        expect(await cache.refresh('updated')).toBe(3);
        const derive = vi.fn((value: number) => value * 2);
        expect(await cache.memoize(['key'], ['default'], derive)).toBe(6);
        advance(500);
        resolveOld(2);
        expect(await oldRead).toBe(2);
        expect(await cache.value()).toBe(3);
        expect(await cache.memoize(['key'], ['default'], derive)).toBe(6);
        expect(derive).toHaveBeenCalledTimes(1);
        advance(501);
        fetch.mockResolvedValueOnce(4);
        expect(await cache.value()).toBe(4);
    });

    it('allows an older successful refresh to publish when a newer refresh fails', async () => {
        const { cache, fetch } = await setup();
        let resolveOld!: (value: number) => void;
        fetch.mockImplementationOnce(() => new Promise<number>(resolve => (resolveOld = resolve)));
        const oldRead = cache.value();
        const log = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        try {
            fetch.mockRejectedValueOnce(new Error('database unavailable'));
            expect(await cache.refresh('updated')).toBe(1);
            resolveOld(2);
            expect(await oldRead).toBe(2);
            expect(await cache.value()).toBe(2);
        } finally {
            log.mockRestore();
        }
    });

    it('publishes both refreshes when they finish in start order', async () => {
        const { cache, fetch } = await setup();
        let resolveOld!: (value: number) => void;
        let resolveNew!: (value: number) => void;
        fetch.mockImplementationOnce(() => new Promise<number>(resolve => (resolveOld = resolve)));
        fetch.mockImplementationOnce(() => new Promise<number>(resolve => (resolveNew = resolve)));
        const oldRead = cache.value();
        const newRead = cache.refresh('updated');
        resolveOld(2);
        expect(await oldRead).toBe(2);
        expect(await cache.value()).toBe(2);
        resolveNew(3);
        expect(await newRead).toBe(3);
        expect(await cache.value()).toBe(3);
    });

    it('invalidates memoized results when a shared refresh completes', async () => {
        let now = 0;
        const fetch = vi.fn(async () => 1);
        const cache = await createSelfRefreshingCache({
            name: 'memoized',
            ttl: 1000,
            refresh: { fn: fetch, defaultArgs: [] },
            getTimeFn: () => now,
        });
        const derive = vi.fn((value: number) => value * 2);
        now = 500;
        expect(await cache.memoize(['key'], [], derive)).toBe(2);
        now = 1001;
        fetch.mockResolvedValueOnce(2);
        await Promise.all([cache.value(), cache.value()]);
        expect(await cache.memoize(['key'], [], derive)).toBe(4);
        expect(derive).toHaveBeenCalledTimes(2);
    });
});
