import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { LockNotSupportedOnGivenDriverError, PessimisticLockTransactionRequiredError } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { DefaultStockLocationStrategy } from '../../config/catalog/default-stock-location-strategy';
import { Logger } from '../../config/logger/vendure-logger';
import { Channel } from '../../entity/channel/channel.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';

import { StockLevelService } from './stock-level.service';

/**
 * Unit tests for the two properties which the e2e tests cannot observe from outside:
 *
 * 1. The stock level change goes through `Repository.increment()`, which writes an atomic
 *    `column = column + change` SQL expression, never a value computed in JavaScript.
 * 2. The saleable stock check reads the StockLevel rows under a `pessimistic_write` lock,
 *    in a fixed row order, and degrades to an unlocked read on drivers which have no
 *    row locks.
 *
 * See GHSA-8ghm-q833-cmgp.
 */
describe('StockLevelService locking and atomic updates', () => {
    const ctx = {} as RequestContext;

    let capturedIncrements: Array<{ conditions: any; property: string; value: number }>;
    let capturedSaves: any[];
    let selectQueryBuilder: any;
    let findResult: StockLevel[];
    let findOneResult: StockLevel | null;
    let capturedUpdates: Array<{ criteria: any; partial: any }>;
    let updateAffected: number;
    let variants: ProductVariant[];
    let globalTrackInventory: boolean;

    function createRepository() {
        return {
            findOne: vi.fn(() => Promise.resolve(findOneResult)),
            find: vi.fn(() => Promise.resolve(findResult)),
            save: vi.fn((entity: any) => {
                capturedSaves.push(entity);
                return Promise.resolve(entity);
            }),
            increment: vi.fn((conditions: any, property: string, value: number) => {
                capturedIncrements.push({ conditions, property, value });
                return Promise.resolve({ affected: 1 });
            }),
            update: vi.fn((criteria: any, partial: any) => {
                capturedUpdates.push({ criteria, partial });
                return Promise.resolve({ affected: updateAffected });
            }),
            createQueryBuilder: vi.fn(() => selectQueryBuilder),
        };
    }

    function createService() {
        const variantRepository = { find: vi.fn(() => Promise.resolve(variants)) };
        const connection: any = {
            getRepository: vi.fn((_ctx: any, entity: any) =>
                entity === ProductVariant ? variantRepository : createRepository(),
            ),
        };
        const configService: any = {
            catalogOptions: { stockLocationStrategy: new DefaultStockLocationStrategy() },
        };
        const globalSettingsService: any = {
            getSettings: () => Promise.resolve({ trackInventory: globalTrackInventory }),
        };
        return new StockLevelService(
            connection,
            {} as any,
            configService,
            new RequestContextCacheService(),
            globalSettingsService,
        );
    }

    beforeEach(() => {
        capturedIncrements = [];
        capturedSaves = [];
        capturedUpdates = [];
        updateAffected = 0;
        variants = [];
        globalTrackInventory = true;
        findResult = [];
        findOneResult = new StockLevel({ id: 42, stockOnHand: 10, stockAllocated: 3 });
        selectQueryBuilder = {
            setLock: vi.fn(() => selectQueryBuilder),
            where: vi.fn(() => selectQueryBuilder),
            orderBy: vi.fn(() => selectQueryBuilder),
            getMany: vi.fn(() => Promise.resolve(findResult)),
        };
    });

    describe('atomic stock level updates', () => {
        it('updateStockAllocatedForLocation increments the column in SQL', async () => {
            await createService().updateStockAllocatedForLocation(ctx, 1, 1, 5);

            expect(capturedIncrements).toEqual([
                { conditions: { id: 42 }, property: 'stockAllocated', value: 5 },
            ]);
        });

        it('updateStockOnHandForLocation increments the column in SQL', async () => {
            await createService().updateStockOnHandForLocation(ctx, 1, 1, -2);

            expect(capturedIncrements).toEqual([
                { conditions: { id: 42 }, property: 'stockOnHand', value: -2 },
            ]);
        });

        it('creates the StockLevel row when none exists yet', async () => {
            findOneResult = null;

            await createService().updateStockOnHandForLocation(ctx, 1, 1, 7);

            expect(capturedIncrements.length).toBe(0);
            expect(capturedSaves.length).toBe(1);
            expect(capturedSaves[0]).toMatchObject({
                productVariantId: 1,
                stockLocationId: 1,
                stockOnHand: 7,
                stockAllocated: 0,
            });
        });

        it('does not clamp stockAllocated when the change is positive', async () => {
            await createService().updateStockAllocatedForLocation(ctx, 1, 1, 5);

            expect(capturedUpdates.length).toBe(0);
        });

        it('clamps a negative stockAllocated to 0 in SQL after a release', async () => {
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            try {
                await createService().updateStockAllocatedForLocation(ctx, 1, 1, -2);

                expect(capturedIncrements).toEqual([
                    { conditions: { id: 42 }, property: 'stockAllocated', value: -2 },
                ]);
                expect(capturedUpdates.length).toBe(1);
                expect(capturedUpdates[0].criteria.id).toBe(42);
                expect(capturedUpdates[0].criteria.stockAllocated.type).toBe('lessThan');
                expect(capturedUpdates[0].criteria.stockAllocated.value).toBe(0);
                expect(capturedUpdates[0].partial).toEqual({ stockAllocated: 0 });
                expect(warnSpy).not.toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('warns when the clamp fires', async () => {
            updateAffected = 1;
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            try {
                await createService().updateStockAllocatedForLocation(ctx, 1, 1, -5);

                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).toContain('clamped to 0');
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('does nothing when allocating against a StockLevel row which does not exist', async () => {
            findOneResult = null;

            await createService().updateStockAllocatedForLocation(ctx, 1, 1, 7);

            expect(capturedIncrements.length).toBe(0);
            expect(capturedSaves.length).toBe(0);
        });
    });

    describe('getAvailableStock', () => {
        it('does not lock by default', async () => {
            findResult = [new StockLevel({ id: 1, productVariantId: 1, stockOnHand: 10, stockAllocated: 2 })];

            const result = await createService().getAvailableStock(ctx, 1);

            expect(selectQueryBuilder.setLock).not.toHaveBeenCalled();
            expect(result).toEqual({ stockOnHand: 10, stockAllocated: 2 });
        });

        it('takes a write lock in a fixed row order when asked to', async () => {
            findResult = [new StockLevel({ id: 1, stockOnHand: 10, stockAllocated: 2 })];

            const result = await createService().getAvailableStock(ctx, 1, { lockStockLevels: true });

            expect(selectQueryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
            expect(selectQueryBuilder.orderBy).toHaveBeenCalledWith('stockLevel.id', 'ASC');
            expect(result).toEqual({ stockOnHand: 10, stockAllocated: 2 });
        });

        it('warns and falls back to an unlocked read on drivers without row locks', async () => {
            findResult = [new StockLevel({ id: 1, stockOnHand: 4, stockAllocated: 1 })];
            selectQueryBuilder.getMany = vi.fn(() =>
                Promise.reject(new LockNotSupportedOnGivenDriverError()),
            );
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            try {
                const result = await createService().getAvailableStock(ctx, 1, { lockStockLevels: true });

                expect(result).toEqual({ stockOnHand: 4, stockAllocated: 1 });
                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).toContain('does not support row locking');
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('warns about missing row lock support only once', async () => {
            findResult = [new StockLevel({ id: 1, stockOnHand: 4, stockAllocated: 1 })];
            selectQueryBuilder.getMany = vi.fn(() =>
                Promise.reject(new LockNotSupportedOnGivenDriverError()),
            );
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            try {
                const service = createService();
                await service.getAvailableStock(ctx, 1, { lockStockLevels: true });
                await service.getAvailableStock(ctx, 1, { lockStockLevels: true });

                expect(warnSpy).toHaveBeenCalledTimes(1);
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('warns and falls back to an unlocked read when no transaction is open', async () => {
            findResult = [new StockLevel({ id: 1, stockOnHand: 6, stockAllocated: 2 })];
            selectQueryBuilder.getMany = vi.fn(() =>
                Promise.reject(new PessimisticLockTransactionRequiredError()),
            );
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            try {
                const result = await createService().getAvailableStock(ctx, 1, { lockStockLevels: true });

                expect(result).toEqual({ stockOnHand: 6, stockAllocated: 2 });
                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).toContain('no transaction is in progress');
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('warns about a missing transaction only once', async () => {
            selectQueryBuilder.getMany = vi.fn(() =>
                Promise.reject(new PessimisticLockTransactionRequiredError()),
            );
            const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            try {
                const service = createService();
                await service.getLockedStockLevelsForVariant(ctx, 1);
                await service.getAvailableStock(ctx, 1, { lockStockLevels: true });

                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][1]).toBe('StockLevelService');
            } finally {
                warnSpy.mockRestore();
            }
        });

        it('locks several variants once each, in the shared lock order', async () => {
            variants = [10, 9, 2].map(id => new ProductVariant({ id, trackInventory: GlobalFlag.TRUE }));

            await createService().lockStockLevelsForVariants(ctx, [10, 9, 10, 2]);

            expect(
                selectQueryBuilder.where.mock.calls.map((call: any[]) => call[1].productVariantId),
            ).toEqual([2, 9, 10]);
            expect(selectQueryBuilder.setLock).toHaveBeenCalledTimes(3);
        });

        it('does not lock variants which do not track inventory', async () => {
            globalTrackInventory = false;
            variants = [
                new ProductVariant({ id: 1, trackInventory: GlobalFlag.TRUE }),
                new ProductVariant({ id: 2, trackInventory: GlobalFlag.FALSE }),
                new ProductVariant({ id: 3, trackInventory: GlobalFlag.INHERIT }),
            ];

            await createService().lockStockLevelsForVariants(ctx, [1, 2, 3]);

            expect(
                selectQueryBuilder.where.mock.calls.map((call: any[]) => call[1].productVariantId),
            ).toEqual([1]);
        });

        it('locks variants which inherit inventory tracking when it is on globally', async () => {
            globalTrackInventory = true;
            variants = [
                new ProductVariant({ id: 2, trackInventory: GlobalFlag.FALSE }),
                new ProductVariant({ id: 3, trackInventory: GlobalFlag.INHERIT }),
            ];

            await createService().lockStockLevelsForVariants(ctx, [2, 3]);

            expect(
                selectQueryBuilder.where.mock.calls.map((call: any[]) => call[1].productVariantId),
            ).toEqual([3]);
        });

        it('locks variants which do not track inventory when asked to include them', async () => {
            globalTrackInventory = false;
            variants = [
                new ProductVariant({ id: 1, trackInventory: GlobalFlag.TRUE }),
                new ProductVariant({ id: 2, trackInventory: GlobalFlag.FALSE }),
                new ProductVariant({ id: 3, trackInventory: GlobalFlag.INHERIT }),
            ];

            await createService().lockStockLevelsForVariants(ctx, [3, 1, 2], {
                includeUntrackedVariants: true,
            });

            expect(
                selectQueryBuilder.where.mock.calls.map((call: any[]) => call[1].productVariantId),
            ).toEqual([1, 2, 3]);
        });

        it('deduplicates when including untracked variants', async () => {
            await createService().lockStockLevelsForVariants(ctx, [10, 9, 10, 2], {
                includeUntrackedVariants: true,
            });

            expect(
                selectQueryBuilder.where.mock.calls.map((call: any[]) => call[1].productVariantId),
            ).toEqual([2, 9, 10]);
        });

        it('does not read the ProductVariants at all when including untracked variants', async () => {
            const variantRepositoryFind = vi.fn(() => Promise.resolve(variants));
            const connection: any = {
                getRepository: vi.fn((_ctx: any, entity: any) =>
                    entity === ProductVariant ? { find: variantRepositoryFind } : createRepository(),
                ),
            };
            const service = new StockLevelService(
                connection,
                {} as any,
                { catalogOptions: { stockLocationStrategy: new DefaultStockLocationStrategy() } } as any,
                new RequestContextCacheService(),
                { getSettings: () => Promise.resolve({ trackInventory: true }) } as any,
            );

            await service.lockStockLevelsForVariants(ctx, [1, 2], { includeUntrackedVariants: true });

            expect(variantRepositoryFind).not.toHaveBeenCalled();
        });

        it('does not mutate the ids passed by the caller', async () => {
            const ids = [10, 9, 2];

            await createService().lockStockLevelsForVariants(ctx, ids, {
                includeUntrackedVariants: true,
            });

            expect(ids).toEqual([10, 9, 2]);
        });

        it('rethrows errors which are not about locking support', async () => {
            selectQueryBuilder.getMany = vi.fn(() => Promise.reject(new Error('connection lost')));

            await expect(
                createService().getAvailableStock(ctx, 1, { lockStockLevels: true }),
            ).rejects.toThrow('connection lost');
        });
    });
});

/**
 * Unit tests for the request-scoped batching of StockLevel lookups. Concurrent lookups within
 * one RequestContext share a single query, including the separate `stockOnHand` and
 * `stockAllocated` field resolvers of the Admin API.
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

type QueryBuilderRead = {
    selectedRelations: string[];
    clauses: string[];
    params: Record<string, any>;
    orderBy?: string;
};

/**
 * The selected relations, where clauses, bound parameters and ordering of each query-builder
 * read, newest last.
 */
const queryBuilderReads: QueryBuilderRead[] = [];

function createQueryBuilder() {
    const read: QueryBuilderRead = { selectedRelations: [], clauses: [], params: {} };
    const record = (clause: string, params: Record<string, any>) => {
        read.clauses.push(clause);
        Object.assign(read.params, params);
        return queryBuilder;
    };
    const queryBuilder: any = {
        leftJoinAndSelect: (relation: string) => {
            read.selectedRelations.push(relation);
            return queryBuilder;
        },
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
            const selectsStockLocation = read.selectedRelations.includes('stockLevel.stockLocation');
            const rows = allStockLevelsWithLocation
                .filter(
                    sl =>
                        ids.map(id => String(id)).includes(String(sl.productVariantId)) &&
                        sl.stockLocation.channels.some(c => String(c.id) === String(read.params.channelId)),
                )
                .map(sl => (selectsStockLocation ? sl : new StockLevel({ ...sl, stockLocation: undefined })));
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
            {} as any,
        );
    });

    describe('getAvailableStock', () => {
        it('batches concurrent lookups into a single query', async () => {
            const results = await Promise.all([1, 2, 3, 4, 5].map(id => service.getAvailableStock(ctx, id)));

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
            await Promise.all([service.getAvailableStock(ctx, 1), service.getAvailableStock(newCtx(), 2)]);

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
            // The fixture rows are not in this order, so the batch must ask the database for it.
            expect(variant1.map(sl => sl.stockLocationId)).toEqual([1, 2]);
            expect(variant2.map(sl => sl.stockLocationId)).toEqual([1]);
        });

        it('includes the StockLocation relation on each StockLevel', async () => {
            const stockLevels = await service.getStockLevelsForVariant(ctx, 1);

            expect(stockLevels.map(sl => sl.stockLocation)).toEqual([location1, location2]);
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

            // The mock filters rows on the bound channelId but cannot evaluate SQL, so the clause
            // that uses it is asserted directly.
            expect(queryBuilderReads[0].clauses).toContain('channel.id = :channelId');
            expect(queryBuilderReads[0].params.channelId).toBe(42);
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
