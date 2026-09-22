import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Channel } from '../../entity/channel/channel.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';

import { StockLevelService } from './stock-level.service';

/**
 * Unit tests for the request-scoped batching of StockLevel lookups. Resolving the stock of a
 * list of ProductVariants used to issue one query per variant, and two per variant on the
 * Admin API, where `stockOnHand` and `stockAllocated` are separate field resolvers.
 */

/** One row per variant 1-5, all at stock location 1. */
const allStockLevels = [1, 2, 3, 4, 5].map(
    productVariantId =>
        new StockLevel({
            id: productVariantId,
            stockLocationId: 1,
            stockOnHand: productVariantId * 10,
            stockAllocated: 1,
            productVariantId,
        }),
);

const find = vi.fn(({ where }: any) => {
    const requestedIds: Array<string | number> = where.productVariantId._value;
    const ids = requestedIds.map(id => String(id));
    return Promise.resolve(allStockLevels.filter(sl => ids.includes(String(sl.productVariantId))));
});

/**
 * The rows behind `getStockLevelsForVariant`, which selects the StockLocation relation and
 * filters on the Channel. Location 1 is in channel 1 only, location 2 is in both channels, and
 * variant 1 holds stock in both, so a variant can be seen through either channel with a
 * different set of rows.
 */
const location1 = new StockLocation({ id: 1, channels: [new Channel({ id: 1 })] });
const location2 = new StockLocation({
    id: 2,
    channels: [new Channel({ id: 1 }), new Channel({ id: 42 })],
});
const allStockLevelsWithLocation = [
    // Ahead of variant 1's location-1 row on purpose: the rows are not in stockLocationId order,
    // so a test asserting that order is asserting that the query asked for it.
    new StockLevel({
        id: 6,
        stockLocationId: 2,
        stockLocation: location2,
        stockOnHand: 7,
        stockAllocated: 0,
        productVariantId: 1,
    }),
    ...allStockLevels.map(sl => new StockLevel({ ...sl, stockLocation: location1 })),
];

/** The bound parameters and ordering of each query-builder read, newest last. */
const queryBuilderReads: Array<{ params: Record<string, any>; orderBy?: string }> = [];

function createQueryBuilder() {
    const read: { params: Record<string, any>; orderBy?: string } = { params: {} };
    const record = (clause: string, params: Record<string, any>) => {
        Object.assign(read.params, params);
        return queryBuilder;
    };
    const queryBuilder: any = {
        leftJoinAndSelect: () => queryBuilder,
        leftJoin: () => queryBuilder,
        where: record,
        andWhere: record,
        orderBy: (field: string) => {
            read.orderBy = field;
            return queryBuilder;
        },
        getMany: () => {
            queryBuilderReads.push(read);
            const ids: Array<string | number> = read.params.productVariantIds;
            const rows = allStockLevelsWithLocation.filter(
                sl =>
                    ids.map(id => String(id)).includes(String(sl.productVariantId)) &&
                    sl.stockLocation.channels.some(c => String(c.id) === String(read.params.channelId)),
            );
            if (!read.orderBy) {
                return Promise.resolve(rows);
            }
            const field = read.orderBy.replace('stockLevel.', '');
            return Promise.resolve(
                [...rows].sort((a, b) => Number((a as any)[field]) - Number((b as any)[field])),
            );
        },
    };
    return queryBuilder;
}

const mockConnection = {
    getRepository: () => ({ find, createQueryBuilder }),
} as any;

// Sums the levels it is given, as DefaultStockLocationStrategy does, so the assertions are
// about which rows reach the strategy rather than about channel filtering.
const mockConfigService = {
    catalogOptions: {
        stockLocationStrategy: {
            getAvailableStock: (ctx: RequestContext, productVariantId: any, stockLevels: StockLevel[]) => ({
                stockOnHand: stockLevels.reduce((sum, sl) => sum + sl.stockOnHand, 0),
                stockAllocated: stockLevels.reduce((sum, sl) => sum + sl.stockAllocated, 0),
            }),
        },
    },
} as any;

function newCtx(channelId = 1): RequestContext {
    return new RequestContext({
        apiType: 'shop',
        channel: new Channel({ id: channelId }),
        authorizedAsOwnerOnly: false,
        isAuthorized: true,
        session: {} as any,
    } as any);
}

describe('StockLevelService', () => {
    let service: StockLevelService;
    let ctx: RequestContext;

    beforeEach(() => {
        find.mockClear();
        queryBuilderReads.length = 0;
        ctx = newCtx();
        service = new StockLevelService(
            mockConnection,
            {} as any,
            mockConfigService,
            new RequestContextCacheService(),
        );
    });

    describe('getAvailableStock', () => {
        it('batches concurrent lookups into a single query', async () => {
            const results = await Promise.all(
                [1, 2, 3, 4, 5].map(id => service.getAvailableStock(ctx, id)),
            );

            expect(find).toHaveBeenCalledTimes(1);
            expect(results.map(r => r.stockOnHand)).toEqual([10, 20, 30, 40, 50]);
            expect(results.map(r => r.stockAllocated)).toEqual([1, 1, 1, 1, 1]);
        });

        it('batches repeated lookups of the same variant into a single query', async () => {
            // The Admin API resolves `stockOnHand` and `stockAllocated` separately, so the same
            // variant is loaded twice in one tick.
            const [first, second] = await Promise.all([
                service.getAvailableStock(ctx, 1),
                service.getAvailableStock(ctx, 1),
            ]);

            expect(find).toHaveBeenCalledTimes(1);
            expect(first).toEqual(second);
        });

        it('returns zero stock for a variant with no StockLevel rows', async () => {
            const result = await service.getAvailableStock(ctx, 99);

            expect(result).toEqual({ stockOnHand: 0, stockAllocated: 0 });
        });

        it('re-reads on a later tick, so stock changed within a request is not stale', async () => {
            await service.getAvailableStock(ctx, 1);
            await service.getAvailableStock(ctx, 1);

            expect(find).toHaveBeenCalledTimes(2);
        });

        it('does not share a batch across RequestContexts', async () => {
            await Promise.all([
                service.getAvailableStock(ctx, 1),
                service.getAvailableStock(newCtx(), 2),
            ]);

            expect(find).toHaveBeenCalledTimes(2);
        });
    });

    // The Admin API `ProductVariant.stockLevels` field, which is channel-filtered and therefore
    // reads through its own loader rather than the one behind `getAvailableStock`.
    describe('getStockLevelsForVariant', () => {
        it('batches concurrent lookups into a single query', async () => {
            const results = await Promise.all(
                [2, 3, 4, 5].map(id => service.getStockLevelsForVariant(ctx, id)),
            );

            expect(queryBuilderReads.length).toBe(1);
            expect(queryBuilderReads[0].params.productVariantIds).toEqual([2, 3, 4, 5]);
            expect(results.map(levels => levels.map(sl => sl.productVariantId))).toEqual([
                [2],
                [3],
                [4],
                [5],
            ]);
        });

        it('groups every row of a batch onto the variant it belongs to, by stock location', async () => {
            const [variant1, variant2] = await Promise.all([
                service.getStockLevelsForVariant(ctx, 1),
                service.getStockLevelsForVariant(ctx, 2),
            ]);

            expect(queryBuilderReads.length).toBe(1);
            // The fixture rows are not in this order, so the batch must have asked the database
            // for it - the unbatched query got it for free from the (productVariantId,
            // stockLocationId) index.
            expect(variant1.map(sl => sl.stockLocationId)).toEqual([1, 2]);
            expect(variant2.map(sl => sl.stockLocationId)).toEqual([1]);
        });

        it('selects the StockLocation relation, as the unbatched query did', async () => {
            const [stockLevel] = await service.getStockLevelsForVariant(ctx, 2);

            expect(stockLevel.stockLocation).toBe(location1);
        });

        it('returns an empty array for a variant with no StockLevel rows', async () => {
            const result = await service.getStockLevelsForVariant(ctx, 99);

            expect(result).toEqual([]);
        });

        it('returns only the stock levels visible in the Channel of the RequestContext', async () => {
            // Location 2 is in channel 42, location 1 is not.
            const otherChannelCtx = newCtx(42);
            const [variant1, variant2] = await Promise.all([
                service.getStockLevelsForVariant(otherChannelCtx, 1),
                service.getStockLevelsForVariant(otherChannelCtx, 2),
            ]);

            expect(variant1.map(sl => sl.stockLocationId)).toEqual([2]);
            expect(variant2).toEqual([]);
        });

        it('re-reads on a later tick, so levels changed within a request are not stale', async () => {
            await service.getStockLevelsForVariant(ctx, 1);
            await service.getStockLevelsForVariant(ctx, 1);

            expect(queryBuilderReads.length).toBe(2);
        });

        it('does not share a batch across RequestContexts', async () => {
            await Promise.all([
                service.getStockLevelsForVariant(ctx, 1),
                service.getStockLevelsForVariant(newCtx(), 2),
            ]);

            expect(queryBuilderReads.length).toBe(2);
        });

        it('does not share a batch with getAvailableStock', async () => {
            await Promise.all([service.getStockLevelsForVariant(ctx, 1), service.getAvailableStock(ctx, 1)]);

            expect(queryBuilderReads.length).toBe(1);
            expect(find).toHaveBeenCalledTimes(1);
        });
    });
});
