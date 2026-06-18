import { beforeAll, describe, expect, it, vi } from 'vitest';

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
