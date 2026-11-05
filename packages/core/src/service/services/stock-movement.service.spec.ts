import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';

import { StockMovementService } from './stock-movement.service';

/**
 * Unit tests for the one property of an absolute stock adjustment which the e2e tests cannot
 * observe from outside: the current `stockOnHand` the delta is derived from comes from the
 * locking read, and the whole adjustment runs in a transaction so that read can take its lock.
 *
 * `StockLevelService.updateStockOnHandForLocation` applies the delta as an atomic
 * `stockOnHand = stockOnHand + delta`, so a delta derived from a stale read is applied on top of
 * whatever another transaction committed in the meantime, rather than overwriting it. Two admins
 * who both read 10 and then set 15 and 12 would store 17.
 */
describe('StockMovementService.adjustProductVariantStock', () => {
    const ctx = { apiType: 'admin' } as RequestContext;

    let lockedStockLevels: StockLevel[];
    let getStockLevelResult: StockLevel;
    let lockedReads: Array<{ productVariantId: any }>;
    let unlockedReads: Array<{ productVariantId: any; stockLocationId: any }>;
    let stockOnHandWrites: Array<{ productVariantId: any; stockLocationId: any; change: number }>;
    let savedAdjustments: any[];
    let transactionsStarted: number;

    function createService() {
        const connection: any = {
            withTransaction: vi.fn((transactionCtx: any, work: any) => {
                transactionsStarted++;
                return work(transactionCtx);
            }),
            getRepository: vi.fn(() => ({
                save: vi.fn((entity: any) => {
                    savedAdjustments.push(entity);
                    return Promise.resolve(entity);
                }),
            })),
        };
        const stockLevelService: any = {
            getLockedStockLevelsForVariant: vi.fn((_ctx: any, productVariantId: any) => {
                lockedReads.push({ productVariantId });
                return Promise.resolve(lockedStockLevels);
            }),
            getStockLevel: vi.fn((_ctx: any, productVariantId: any, stockLocationId: any) => {
                unlockedReads.push({ productVariantId, stockLocationId });
                return Promise.resolve(getStockLevelResult);
            }),
            updateStockOnHandForLocation: vi.fn(
                (_ctx: any, productVariantId: any, stockLocationId: any, change: number) => {
                    stockOnHandWrites.push({ productVariantId, stockLocationId, change });
                    return Promise.resolve();
                },
            ),
        };
        const stockLocationService: any = {
            defaultStockLocation: () => Promise.resolve({ id: 100 }),
        };
        const eventBus: any = { publish: vi.fn(() => Promise.resolve()) };
        return new StockMovementService(
            connection,
            {} as any,
            {} as any,
            stockLevelService,
            eventBus,
            stockLocationService,
        );
    }

    beforeEach(() => {
        lockedReads = [];
        unlockedReads = [];
        stockOnHandWrites = [];
        savedAdjustments = [];
        transactionsStarted = 0;
        lockedStockLevels = [
            new StockLevel({ id: 1, productVariantId: 7, stockLocationId: 100, stockOnHand: 10 }),
        ];
        getStockLevelResult = new StockLevel({
            id: 2,
            productVariantId: 7,
            stockLocationId: 200,
            stockOnHand: 0,
        });
    });

    it('runs in a transaction, so the locking read can take its lock', async () => {
        await createService().adjustProductVariantStock(ctx, 7, 15);

        expect(transactionsStarted).toBe(1);
    });

    it('derives the delta from the locking read, not an unlocked one', async () => {
        await createService().adjustProductVariantStock(ctx, 7, 15);

        expect(lockedReads).toEqual([{ productVariantId: 7 }]);
        expect(unlockedReads).toEqual([]);
        expect(stockOnHandWrites).toEqual([{ productVariantId: 7, stockLocationId: 100, change: 5 }]);
        expect(savedAdjustments.map(a => a.quantity)).toEqual([5]);
    });

    it('takes one locking read for the variant, whatever the number of locations', async () => {
        lockedStockLevels = [
            new StockLevel({ id: 1, productVariantId: 7, stockLocationId: 100, stockOnHand: 10 }),
            new StockLevel({ id: 2, productVariantId: 7, stockLocationId: 101, stockOnHand: 4 }),
        ];

        await createService().adjustProductVariantStock(ctx, 7, [
            { stockLocationId: 101, stockOnHand: 1 },
            { stockLocationId: 100, stockOnHand: 12 },
        ]);

        expect(lockedReads).toEqual([{ productVariantId: 7 }]);
        expect(stockOnHandWrites).toEqual([
            { productVariantId: 7, stockLocationId: 101, change: -3 },
            { productVariantId: 7, stockLocationId: 100, change: 2 },
        ]);
    });

    it('records no adjustment when the requested value is the current one', async () => {
        await createService().adjustProductVariantStock(ctx, 7, 10);

        expect(stockOnHandWrites).toEqual([]);
        expect(savedAdjustments).toEqual([]);
    });

    it('creates the StockLevel row for a location the locking read returned nothing for', async () => {
        await createService().adjustProductVariantStock(ctx, 7, [{ stockLocationId: 200, stockOnHand: 3 }]);

        expect(unlockedReads).toEqual([{ productVariantId: 7, stockLocationId: 200 }]);
        expect(stockOnHandWrites).toEqual([{ productVariantId: 7, stockLocationId: 200, change: 3 }]);
    });

    // Degenerate but accepted input. Each entry has to apply its delta to the value the previous
    // one produced, otherwise both are derived from the one locking read and the stored value is
    // neither of the two requested.
    it('applies two inputs for the same location in sequence', async () => {
        const adjustments = await createService().adjustProductVariantStock(ctx, 7, [
            { stockLocationId: 100, stockOnHand: 15 },
            { stockLocationId: 100, stockOnHand: 12 },
        ]);

        expect(stockOnHandWrites).toEqual([
            { productVariantId: 7, stockLocationId: 100, change: 5 },
            { productVariantId: 7, stockLocationId: 100, change: -3 },
        ]);
        expect(adjustments.map(a => a.quantity)).toEqual([5, -3]);
    });
});
