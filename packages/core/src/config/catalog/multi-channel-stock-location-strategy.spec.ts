import { Subject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { Cache } from '../../cache/cache';
import { Channel } from '../../entity/channel/channel.entity';
import { Product } from '../../entity/product/product.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { ChangeChannelEvent } from '../../event-bus/events/change-channel-event';
import { StockLocationEvent } from '../../event-bus/events/stock-location-event';
import { ensureConfigLoaded } from '../config-helpers';
import { Logger } from '../logger/vendure-logger';

/**
 * Unit tests for the MultiChannelStockLocationStrategy channelId cache invalidation.
 *
 * The real `Cache` wrapper is used (backed by an in-memory Map) so that the
 * key-prefixing behaviour of `Cache.get()`/`Cache.delete()` matches production —
 * the invalidation bugs under test live exactly in that interaction.
 */

const cacheStore = new Map<string, any>();
/** When set, the backing store rejects deletes, simulating an unavailable cache backend. */
let deleteRejection: Error | undefined;
const mockCacheService = {
    createCache: (config: any) =>
        new Cache(config, {
            get: (key: string) => Promise.resolve(cacheStore.get(key)),
            set: (key: string, value: any) => {
                cacheStore.set(key, value);
                return Promise.resolve();
            },
            delete: (key: string) => {
                if (deleteRejection) {
                    return Promise.reject(deleteRejection);
                }
                cacheStore.delete(key);
                return Promise.resolve();
            },
        } as any),
} as any;

// Replaced before each test: `init()` subscribes and nothing tears the subscription down,
// so a shared stream would deliver one event to every strategy built so far.
let eventStream = new Subject<any>();
const mockEventBus = {
    ofType: (type: any) => eventStream.asObservable().pipe(filter((e: any) => e.constructor === type)),
} as any;

let channelsInDb: Channel[];
const getEntityOrThrow = vi.fn(() => Promise.resolve(new StockLocation({ id: 1, channels: channelsInDb })));

const mockInjector = {
    get: (token: unknown) => {
        const name = (token as { name?: string })?.name;
        if (name === 'EventBus') return mockEventBus;
        if (name === 'CacheService') return mockCacheService;
        if (name === 'TransactionalConnection') return { getEntityOrThrow };
        return {};
    },
} as any;

const channel1 = new Channel({ id: 1 });
const channel2 = new Channel({ id: 2 });

function contextForChannel(channel: Channel): RequestContext {
    return new RequestContext({
        apiType: 'shop',
        channel,
        authorizedAsOwnerOnly: false,
        isAuthorized: true,
        session: {} as any,
    } as any);
}

const ctxChannel1 = contextForChannel(channel1);
const ctxChannel2 = contextForChannel(channel2);

const stockLevel = new StockLevel({
    stockLocationId: 1,
    stockOnHand: 100,
    stockAllocated: 0,
    productVariantId: 1,
});

const stockLocation = new StockLocation({ id: 1 });

/** Lets the async `subscribe` handlers (cache deletes) settle. */
function flushEventHandlers() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('MultiChannelStockLocationStrategy', () => {
    let strategy: import('./multi-channel-stock-location-strategy').MultiChannelStockLocationStrategy;

    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    beforeEach(async () => {
        cacheStore.clear();
        deleteRejection = undefined;
        eventStream = new Subject<any>();
        channelsInDb = [channel1];
        getEntityOrThrow.mockClear();
        // Dynamic import to avoid vitest circular dependency issue
        const { MultiChannelStockLocationStrategy } =
            await import('./multi-channel-stock-location-strategy.js');
        strategy = new MultiChannelStockLocationStrategy();
        await strategy.init(mockInjector);
    });

    it('caches the channel ids of a StockLocation after the first lookup', async () => {
        const first = await strategy.getAvailableStock(ctxChannel1, 1, [stockLevel]);
        const second = await strategy.getAvailableStock(ctxChannel1, 1, [stockLevel]);

        expect(first.stockOnHand).toBe(100);
        expect(second.stockOnHand).toBe(100);
        expect(getEntityOrThrow).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cache when a StockLocation is updated', async () => {
        // Cache the channel ids while the location belongs to channel1 only
        const stale = await strategy.getAvailableStock(ctxChannel2, 1, [stockLevel]);
        expect(stale.stockOnHand).toBe(0);

        channelsInDb = [channel1, channel2];
        eventStream.next(new StockLocationEvent(ctxChannel1, stockLocation, 'updated'));
        await flushEventHandlers();

        const fresh = await strategy.getAvailableStock(ctxChannel2, 1, [stockLevel]);
        expect(fresh.stockOnHand).toBe(100);
    });

    it('does not invalidate the cache when a StockLocation is created', async () => {
        await strategy.getAvailableStock(ctxChannel1, 1, [stockLevel]);

        eventStream.next(new StockLocationEvent(ctxChannel1, stockLocation, 'created'));
        await flushEventHandlers();

        await strategy.getAvailableStock(ctxChannel1, 1, [stockLevel]);
        expect(getEntityOrThrow).toHaveBeenCalledTimes(1);
    });

    it('invalidates the cache when a StockLocation is assigned to a Channel', async () => {
        // Cache the channel ids before the location is assigned to channel2
        const stale = await strategy.getAvailableStock(ctxChannel2, 1, [stockLevel]);
        expect(stale.stockOnHand).toBe(0);

        channelsInDb = [channel1, channel2];
        eventStream.next(new ChangeChannelEvent(ctxChannel1, stockLocation, [2], 'assigned', StockLocation));
        await flushEventHandlers();

        const fresh = await strategy.getAvailableStock(ctxChannel2, 1, [stockLevel]);
        expect(fresh.stockOnHand).toBe(100);
    });

    it('invalidates the cache when a StockLocation is removed from a Channel', async () => {
        channelsInDb = [channel1, channel2];
        const beforeRemoval = await strategy.getAvailableStock(ctxChannel2, 1, [stockLevel]);
        expect(beforeRemoval.stockOnHand).toBe(100);

        channelsInDb = [channel1];
        eventStream.next(new ChangeChannelEvent(ctxChannel1, stockLocation, [2], 'removed', StockLocation));
        await flushEventHandlers();

        const fresh = await strategy.getAvailableStock(ctxChannel2, 1, [stockLevel]);
        expect(fresh.stockOnHand).toBe(0);
    });

    it('logs rather than throws when the cache backend rejects the invalidation', async () => {
        const logError = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        deleteRejection = new Error('cache backend unavailable');

        eventStream.next(new ChangeChannelEvent(ctxChannel1, stockLocation, [2], 'assigned', StockLocation));
        await flushEventHandlers();

        expect(logError).toHaveBeenCalledTimes(1);
        expect(logError.mock.calls[0][0]).toContain('cache backend unavailable');
        logError.mockRestore();
    });

    it('does not invalidate the cache on ChangeChannelEvents for other entity types', async () => {
        await strategy.getAvailableStock(ctxChannel1, 1, [stockLevel]);

        eventStream.next(
            new ChangeChannelEvent(ctxChannel1, new Product({ id: 1 }) as any, [2], 'assigned', Product),
        );
        await flushEventHandlers();

        await strategy.getAvailableStock(ctxChannel1, 1, [stockLevel]);
        expect(getEntityOrThrow).toHaveBeenCalledTimes(1);
    });
});
