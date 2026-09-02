import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { CacheService } from '../../cache/cache.service';
import { Injector } from '../../common/injector';
import { Country } from '../../entity/region/country.entity';
import { Zone } from '../../entity/zone/zone.entity';

import { DefaultZoneCacheStrategy } from './default-zone-cache-strategy';

describe('DefaultZoneCacheStrategy', () => {
    afterEach(() => vi.useRealTimers());

    it('stores and rehydrates Zones and their members', async () => {
        vi.useFakeTimers();
        const { strategy, cacheService } = createStrategy();
        const zones = createZones();
        const ctx = RequestContext.empty();

        await strategy.set(ctx, zones);

        expect(cacheService.set).toHaveBeenCalledWith('vendure-zone-cache:all', expect.any(Array), {
            tags: ['DefaultZoneCacheStrategy'],
            ttl: 5 * 60_000,
        });
        cacheService.get.mockResolvedValue(cacheService.set.mock.calls[0][1]);
        vi.advanceTimersByTime(30_000);

        const result = await strategy.get(ctx, vi.fn());

        expect(result[0]).toBeInstanceOf(Zone);
        expect(result[0].members[0]).toBeInstanceOf(Country);
        expect(result[0].createdAt).toEqual(zones[0].createdAt);
        expect(result[0].members[0].createdAt).toEqual(zones[0].members[0].createdAt);
    });

    it('coalesces concurrent L1 and L2 misses into one load', async () => {
        const { strategy, cacheService } = createStrategy();
        const zones = createZones();
        const load = vi.fn().mockResolvedValue(zones);
        cacheService.get.mockResolvedValue(undefined);

        const result = await Promise.all([
            strategy.get(RequestContext.empty(), load),
            strategy.get(RequestContext.empty(), load),
        ]);

        expect(result).toEqual([zones, zones]);
        expect(load).toHaveBeenCalledOnce();
        expect(cacheService.get).toHaveBeenCalledOnce();
    });

    it('invalidates L1 and L2', async () => {
        const { strategy, cacheService } = createStrategy();
        const ctx = RequestContext.empty();
        await strategy.set(ctx, createZones());

        await strategy.delete(ctx);

        expect(cacheService.delete).toHaveBeenCalledWith('vendure-zone-cache:all');
    });
});

function createStrategy() {
    const cacheService = {
        get: vi.fn(),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        invalidateTags: vi.fn().mockResolvedValue(undefined),
    };
    const configService = { entityOptions: { zoneCacheTtl: 30_000 } };
    const injector = {
        get: vi.fn((type: unknown) => (type === CacheService ? cacheService : configService)),
    };
    const strategy = new DefaultZoneCacheStrategy();
    strategy.init(injector as unknown as Injector);
    return { strategy, cacheService };
}

function createZones(): Zone[] {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const country = new Country({
        id: 2,
        code: 'ES',
        name: 'Spain',
        createdAt,
        updatedAt: createdAt,
        enabled: true,
        customFields: {},
    } as Country);
    return [
        new Zone({
            id: 1,
            name: 'Europe',
            members: [country],
            createdAt,
            updatedAt: createdAt,
            customFields: {},
        }),
    ];
}
