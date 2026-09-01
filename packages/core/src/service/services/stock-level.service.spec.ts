import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Channel } from '../../entity/channel/channel.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';

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

const mockConnection = {
    getRepository: () => ({ find }),
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

function newCtx(): RequestContext {
    return new RequestContext({
        apiType: 'shop',
        channel: new Channel({ id: 1 }),
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
});
