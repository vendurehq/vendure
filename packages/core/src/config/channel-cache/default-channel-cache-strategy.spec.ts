import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheService } from '../../cache/cache.service';
import { Injector } from '../../common/injector';
import { Channel } from '../../entity/channel/channel.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { ConfigService } from '../config.service';

import { DefaultChannelCacheStrategy } from './default-channel-cache-strategy';

describe('DefaultChannelCacheStrategy', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('stores one Channel under its token and default keys', async () => {
        const { strategy, cacheService } = createStrategy();
        const channel = createChannel();

        await strategy.set(channel);

        const cacheOptions = { tags: ['DefaultChannelCacheStrategy'], ttl: 5 * 60_000 };
        expect(cacheService.set).toHaveBeenCalledWith(
            'vendure-channel-cache:token:test-token',
            expect.any(Object),
            cacheOptions,
        );
        expect(cacheService.set).toHaveBeenCalledWith(
            'vendure-channel-cache:default',
            expect.any(Object),
            cacheOptions,
        );
        const serialized = cacheService.set.mock.calls[0][1];
        expect(serialized.createdAt).toEqual({
            __vendure_channel_cache_date__: channel.createdAt.toISOString(),
        });
        expect(serialized.customFields.launchAt).toEqual({
            __vendure_channel_cache_date__: channel.customFields.launchAt.toISOString(),
        });
    });

    it('rehydrates a cached Channel, its Zones and Date values', async () => {
        vi.useFakeTimers();
        const { strategy, cacheService } = createStrategy();
        const channel = createChannel();
        await strategy.set(channel);
        cacheService.get.mockResolvedValue(cacheService.set.mock.calls[0][1]);
        vi.advanceTimersByTime(30_000);

        const result = await strategy.getByToken(channel.token);

        expect(cacheService.get).toHaveBeenCalledWith('vendure-channel-cache:token:test-token');
        expect(result).toBeInstanceOf(Channel);
        expect(result?.createdAt).toEqual(channel.createdAt);
        expect(result?.customFields.launchAt).toEqual(channel.customFields.launchAt);
        expect(result?.defaultTaxZone).toBeInstanceOf(Zone);
        expect(result?.defaultTaxZone.createdAt).toEqual(channel.defaultTaxZone.createdAt);
        expect(await strategy.getByToken(channel.token)).toBe(result);
        expect(cacheService.get).toHaveBeenCalledOnce();
    });

    it('uses a dedicated key when reading the default Channel', async () => {
        const { strategy, cacheService } = createStrategy();
        cacheService.get.mockResolvedValue(undefined);

        await strategy.getDefault();

        expect(cacheService.get).toHaveBeenCalledWith('vendure-channel-cache:default');
    });

    it('returns a fresh L1 entry without reading or rehydrating L2', async () => {
        const { strategy, cacheService } = createStrategy();
        const channel = createChannel({ code: 'secondary' });
        await strategy.set(channel);
        cacheService.get.mockClear();

        const result = await strategy.getByToken(channel.token);

        expect(result).toBe(channel);
        expect(cacheService.get).not.toHaveBeenCalled();
    });

    it('supports overriding the cache prefix and both TTLs', async () => {
        vi.useFakeTimers();
        const { strategy, cacheService } = createStrategy({
            cachePrefix: 'custom:channels',
            l1CacheTtl: 1234,
            l2CacheTtl: 60_000,
        });
        const channel = createChannel({ code: 'secondary' });

        await strategy.set(channel);

        expect(cacheService.set).toHaveBeenCalledWith(
            'custom:channels:token:test-token',
            expect.any(Object),
            { tags: ['DefaultChannelCacheStrategy'], ttl: 60_000 },
        );
        expect(cacheService.set).toHaveBeenCalledOnce();

        cacheService.get.mockResolvedValue(cacheService.set.mock.calls[0][1]);
        cacheService.get.mockClear();
        vi.advanceTimersByTime(1233);
        expect(await strategy.getByToken(channel.token)).toBe(channel);
        expect(cacheService.get).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(await strategy.getByToken(channel.token)).not.toBe(channel);
        expect(cacheService.get).toHaveBeenCalledOnce();
    });

    it('bounds the number of entries held in L1', async () => {
        const { strategy, cacheService } = createStrategy({ l1CacheSize: 1 });
        const first = createChannel({ code: 'first', token: 'first-token' });
        const second = createChannel({ code: 'second', token: 'second-token' });
        await strategy.set(first);
        await strategy.set(second);
        cacheService.get.mockResolvedValue(undefined);
        cacheService.get.mockClear();

        expect(await strategy.getByToken(second.token)).toBe(second);
        expect(await strategy.getByToken(first.token)).toBeUndefined();
        expect(cacheService.get).toHaveBeenCalledOnce();
    });

    it('deletes the token and default keys from L1 and L2 for the default Channel', async () => {
        const { strategy, cacheService } = createStrategy();
        const channel = createChannel();
        await strategy.set(channel);
        cacheService.get.mockResolvedValue(undefined);
        cacheService.get.mockClear();

        await strategy.delete(channel);
        expect(await strategy.getByToken(channel.token)).toBeUndefined();

        expect(cacheService.delete).toHaveBeenCalledWith('vendure-channel-cache:token:test-token');
        expect(cacheService.delete).toHaveBeenCalledWith('vendure-channel-cache:default');
        expect(cacheService.get).toHaveBeenCalledWith('vendure-channel-cache:token:test-token');
    });

    it('clears all Channel keys from L1 and L2 by tag', async () => {
        const { strategy, cacheService } = createStrategy();
        const channel = createChannel();
        await strategy.set(channel);
        cacheService.get.mockResolvedValue(undefined);
        cacheService.get.mockClear();

        await strategy.clear();
        expect(await strategy.getByToken(channel.token)).toBeUndefined();

        expect(cacheService.invalidateTags).toHaveBeenCalledWith(['DefaultChannelCacheStrategy']);
        expect(cacheService.get).toHaveBeenCalledOnce();
    });
});

function createStrategy(options?: {
    cachePrefix?: string;
    l1CacheTtl?: number;
    l1CacheSize?: number;
    l2CacheTtl?: number;
}) {
    const cacheService = {
        get: vi.fn(),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        invalidateTags: vi.fn().mockResolvedValue(undefined),
    };
    const configService = { entityOptions: { channelCacheTtl: 30_000 } };
    const injector = {
        get: vi.fn((type: unknown) => (type === CacheService ? cacheService : configService)),
    };
    const strategy = new DefaultChannelCacheStrategy(options);
    strategy.init(injector as unknown as Injector);
    return { strategy, cacheService, configService: configService as ConfigService };
}

function createChannel(input?: Partial<Channel>): Channel {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const updatedAt = new Date('2026-02-03T04:05:06.000Z');
    const zone = new Zone({ id: 2, name: 'Europe', createdAt, updatedAt, customFields: {} });
    return new Channel({
        id: 1,
        code: '__default_channel__',
        token: 'test-token',
        description: 'Default channel',
        createdAt,
        updatedAt,
        defaultLanguageCode: LanguageCode.en,
        availableLanguageCodes: [LanguageCode.en],
        defaultCurrencyCode: CurrencyCode.EUR,
        availableCurrencyCodes: [CurrencyCode.EUR],
        defaultTaxZone: zone,
        defaultShippingZone: zone,
        pricesIncludeTax: true,
        trackInventory: true,
        outOfStockThreshold: 0,
        customFields: { launchAt: createdAt } as any,
        ...input,
    });
}
