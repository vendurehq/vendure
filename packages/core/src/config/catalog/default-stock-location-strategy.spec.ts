import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { InternalServerError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { StockLocation } from '../../entity/stock-location/stock-location.entity';
import { ensureConfigLoaded } from '../config-helpers';

import { DefaultStockLocationStrategy } from './default-stock-location-strategy';

/**
 * GHSA-8ghm-q833-cmgp follow-up: `forAllocation()` used to return the full requested quantity
 * from the first StockLocation without reading the stock at all, so with the default
 * StockAllocationStrategy two paid Orders could both allocate the last unit. It now reads the
 * StockLevels under the same write lock the saleable stock check takes, and caps the allocation
 * at what the variant still has available.
 */

const stockLocation = new StockLocation({ id: 1 });
const orderLine = new OrderLine({ id: 1, productVariantId: 1 });

function stockLevels(stockOnHand: number, stockAllocated: number): StockLevel[] {
    return [new StockLevel({ id: 1, stockLocationId: 1, productVariantId: 1, stockOnHand, stockAllocated })];
}

/**
 * The shape a third-party strategy may have: `init()` is a public extension point, so its
 * signature may not become asynchronous. This subclass does not compile if the base `init()`
 * returns `Promise<void>`, and it never awaits `super.init()`, so it also proves that an
 * inherited `forAllocation()` finds its services whether or not the subclass waited for them.
 */
class SyncInitStockLocationStrategy extends DefaultStockLocationStrategy {
    initReturnedVoid = false;

    init(injector: Injector): void {
        const result: void | Promise<void> = super.init(injector);
        // Asserted below. A base `init()` which returned a Promise would not only fail to
        // compile against this override, it would leave the services unresolved for a subclass
        // which does not await it.
        this.initReturnedVoid = result === undefined;
    }
}

/** Overrides `init()` without calling `super.init()`, wiring up only the connection. */
class NoSuperInitStockLocationStrategy extends DefaultStockLocationStrategy {
    init(injector: Injector): void {
        this.connection = injector.get(TransactionalConnection);
    }
}

describe('DefaultStockLocationStrategy', () => {
    let strategy: DefaultStockLocationStrategy;
    let ctx: RequestContext;

    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    function contextWithChannelTracking(trackInventory: boolean): RequestContext {
        return new RequestContext({
            apiType: 'shop',
            channel: new Channel({ id: 1, trackInventory }),
            authorizedAsOwnerOnly: false,
            isAuthorized: true,
            session: {} as any,
        } as any);
    }

    beforeEach(() => {
        ctx = new RequestContext({
            apiType: 'shop',
            channel: new Channel({ id: 1, trackInventory: true }),
            authorizedAsOwnerOnly: false,
            isAuthorized: true,
            session: {} as any,
        } as any);
        strategy = new DefaultStockLocationStrategy();
    });

    /**
     * `init()` resolves its services from the Injector, which needs the whole Nest container, so
     * the three collaborators `forAllocation()` uses are stubbed directly. The unlocked read
     * always runs first (it decides whether anything is tracked); the locked read returns the
     * same rows, so whether the lock was taken is visible only in the call counts, which is
     * exactly what the lock assertions are about. Whether inventory is tracked by default comes
     * from the Channel of the RequestContext, so `channelTrackInventory` replaces `ctx`.
     */
    function setUpAllocation(options: {
        trackInventory: GlobalFlag;
        channelTrackInventory?: boolean;
        useGlobalOutOfStockThreshold?: boolean;
        outOfStockThreshold?: number;
        globalOutOfStockThreshold?: number;
        stockLevels?: StockLevel[];
    }) {
        if (options.channelTrackInventory !== undefined) {
            ctx = contextWithChannelTracking(options.channelTrackInventory);
        }
        const rows = options.stockLevels ?? stockLevels(10, 0);
        const unlockedFind = vi.fn(() => Promise.resolve(rows));
        const lockedRead = vi.fn(() => Promise.resolve(rows));
        (strategy as any).connection = {
            getEntityOrThrow: () =>
                Promise.resolve(
                    new ProductVariant({
                        id: 1,
                        trackInventory: options.trackInventory,
                        useGlobalOutOfStockThreshold: options.useGlobalOutOfStockThreshold ?? true,
                        outOfStockThreshold: options.outOfStockThreshold ?? 0,
                    }),
                ),
            getRepository: () => ({ find: unlockedFind }),
        };
        (strategy as any).globalSettingsService = {
            getSettings: () =>
                Promise.resolve({
                    outOfStockThreshold: options.globalOutOfStockThreshold ?? 0,
                }),
        };
        (strategy as any).stockLevelService = { getLockedStockLevelsForVariant: lockedRead };
        return { unlockedFind, lockedRead };
    }

    describe('forAllocation()', () => {
        it('reads the StockLevels under a lock and allocates the full quantity when stock allows', async () => {
            const { unlockedFind, lockedRead } = setUpAllocation({ trackInventory: GlobalFlag.TRUE });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 3);

            // The unlocked read only decides that the rows are tracked; the figures come from the
            // locked read which follows it.
            expect(unlockedFind).toHaveBeenCalledTimes(1);
            expect(lockedRead).toHaveBeenCalledTimes(1);
            expect(unlockedFind.mock.invocationCallOrder[0]).toBeLessThan(
                lockedRead.mock.invocationCallOrder[0],
            );
            expect(result).toEqual([{ location: stockLocation, quantity: 3, tracked: true }]);
        });

        it('caps the quantity at the stock which is available', async () => {
            setUpAllocation({ trackInventory: GlobalFlag.TRUE, stockLevels: stockLevels(10, 8) });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(result).toEqual([{ location: stockLocation, quantity: 2, tracked: true }]);
        });

        it('allocates nothing when the stock is fully allocated', async () => {
            setUpAllocation({ trackInventory: GlobalFlag.TRUE, stockLevels: stockLevels(10, 10) });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(result).toEqual([]);
        });

        it('allocates nothing when more is allocated than is on hand', async () => {
            setUpAllocation({ trackInventory: GlobalFlag.TRUE, stockLevels: stockLevels(10, 12) });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(result).toEqual([]);
        });

        it('subtracts a positive outOfStockThreshold from the available stock', async () => {
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: 4,
                stockLevels: stockLevels(10, 0),
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 10);

            expect(result).toEqual([{ location: stockLocation, quantity: 6, tracked: true }]);
        });

        it('uses the global outOfStockThreshold when the variant defers to it', async () => {
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                useGlobalOutOfStockThreshold: true,
                outOfStockThreshold: 0,
                globalOutOfStockThreshold: 4,
                stockLevels: stockLevels(10, 0),
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 10);

            expect(result).toEqual([{ location: stockLocation, quantity: 6, tracked: true }]);
        });

        // A negative threshold is the backorder depth, so the allocation may exceed stockOnHand
        // by exactly that much, matching what ProductVariantService.getSaleableStockLevel() reports.
        it('allows a backorder up to a negative outOfStockThreshold', async () => {
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: -5,
                stockLevels: stockLevels(2, 0),
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 10);

            expect(result).toEqual([{ location: stockLocation, quantity: 7, tracked: true }]);
        });

        it('sums the StockLevels of every StockLocation, as getAvailableStock() does', async () => {
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                stockLevels: [
                    new StockLevel({
                        stockLocationId: 1,
                        productVariantId: 1,
                        stockOnHand: 2,
                        stockAllocated: 0,
                    }),
                    new StockLevel({
                        stockLocationId: 2,
                        productVariantId: 1,
                        stockOnHand: 3,
                        stockAllocated: 1,
                    }),
                ],
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 10);

            expect(result).toEqual([{ location: stockLocation, quantity: 4, tracked: true }]);
        });

        // The missing row counts as zero stock on hand and zero allocated, which is the same
        // reading the saleable stock check makes of it, so the two cannot disagree.
        it('allocates nothing for a tracked variant with no StockLevel row', async () => {
            setUpAllocation({ trackInventory: GlobalFlag.TRUE, stockLevels: [] });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(result).toEqual([]);
        });

        it('allows a backorder for a tracked variant with no StockLevel row', async () => {
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: -3,
                stockLevels: [],
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(result).toEqual([{ location: stockLocation, quantity: 3, tracked: true }]);
        });

        // The unlocked read is what shows that none of the rows is tracked, so it still runs.
        it('allocates the full quantity without a lock for an untracked variant', async () => {
            const { unlockedFind, lockedRead } = setUpAllocation({
                trackInventory: GlobalFlag.FALSE,
                stockLevels: stockLevels(0, 0),
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(lockedRead).not.toHaveBeenCalled();
            expect(unlockedFind).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ location: stockLocation, quantity: 5, tracked: false }]);
        });

        it('allocates an untracked variant with no StockLevel row at the first StockLocation', async () => {
            const { lockedRead } = setUpAllocation({ trackInventory: GlobalFlag.FALSE, stockLevels: [] });
            const secondLocation = new StockLocation({ id: 2 });

            const result = await strategy.forAllocation(ctx, [stockLocation, secondLocation], orderLine, 5);

            expect(lockedRead).not.toHaveBeenCalled();
            expect(result).toEqual([{ location: stockLocation, quantity: 5, tracked: false }]);
        });

        it("treats an INHERIT variant as untracked when the Channel's trackInventory is off", async () => {
            const { lockedRead } = setUpAllocation({
                trackInventory: GlobalFlag.INHERIT,
                channelTrackInventory: false,
                stockLevels: stockLevels(0, 0),
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(lockedRead).not.toHaveBeenCalled();
            expect(result).toEqual([{ location: stockLocation, quantity: 5, tracked: false }]);
        });

        it("treats an INHERIT variant as tracked when the Channel's trackInventory is on", async () => {
            const { lockedRead } = setUpAllocation({
                trackInventory: GlobalFlag.INHERIT,
                channelTrackInventory: true,
                stockLevels: stockLevels(2, 0),
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            expect(lockedRead).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ location: stockLocation, quantity: 2, tracked: true }]);
        });

        it('sends the overflow of a tracked variant to a StockLevel which does not track inventory', async () => {
            const untrackedLocation = new StockLocation({ id: 2 });
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                stockLevels: [
                    new StockLevel({
                        id: 1,
                        stockLocationId: 1,
                        productVariantId: 1,
                        stockOnHand: 2,
                        stockAllocated: 0,
                    }),
                    new StockLevel({
                        id: 2,
                        stockLocationId: 2,
                        productVariantId: 1,
                        stockOnHand: 0,
                        stockAllocated: 0,
                        trackInventory: GlobalFlag.FALSE,
                    }),
                ],
            });

            const result = await strategy.forAllocation(
                ctx,
                [stockLocation, untrackedLocation],
                orderLine,
                5,
            );

            expect(result).toEqual([
                { location: stockLocation, quantity: 2, tracked: true },
                { location: untrackedLocation, quantity: 3, tracked: false },
            ]);
        });

        it('uses tracked stock before untracked stock, whatever the order of the StockLocations', async () => {
            const untrackedLocation = new StockLocation({ id: 2 });
            setUpAllocation({
                trackInventory: GlobalFlag.TRUE,
                stockLevels: [
                    new StockLevel({
                        id: 1,
                        stockLocationId: 1,
                        productVariantId: 1,
                        stockOnHand: 10,
                        stockAllocated: 0,
                    }),
                    new StockLevel({
                        id: 2,
                        stockLocationId: 2,
                        productVariantId: 1,
                        stockOnHand: 0,
                        stockAllocated: 0,
                        trackInventory: GlobalFlag.FALSE,
                    }),
                ],
            });

            const result = await strategy.forAllocation(
                ctx,
                [untrackedLocation, stockLocation],
                orderLine,
                4,
            );

            expect(result).toEqual([{ location: stockLocation, quantity: 4, tracked: true }]);
        });

        it('does not cap a StockLevel which tracks inventory on an untracked variant', async () => {
            const { lockedRead } = setUpAllocation({
                trackInventory: GlobalFlag.FALSE,
                stockLevels: [
                    new StockLevel({
                        id: 1,
                        stockLocationId: 1,
                        productVariantId: 1,
                        stockOnHand: 3,
                        stockAllocated: 0,
                        trackInventory: GlobalFlag.TRUE,
                    }),
                ],
            });

            const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

            // The override makes the row tracked, so it is locked and capped, and with no
            // untracked StockLevel to overflow to, the rest is a shortfall.
            expect(lockedRead).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ location: stockLocation, quantity: 3, tracked: true }]);
        });
    });
    describe('subclassing', () => {
        /**
         * Resolves by class name, so the lazily imported GlobalSettingsService and
         * StockLevelService are reached through the real `init()` path rather than stubbed onto
         * the instance as the tests above do.
         */
        function injectorReturning(lockedRead: () => Promise<StockLevel[]>): Injector {
            const connection = {
                getEntityOrThrow: () =>
                    Promise.resolve(
                        new ProductVariant({
                            id: 1,
                            trackInventory: GlobalFlag.TRUE,
                            useGlobalOutOfStockThreshold: true,
                            outOfStockThreshold: 0,
                        }),
                    ),
                // The unlocked read which decides that the rows are tracked. The figures it
                // returns are discarded in favour of the locked read's.
                getRepository: () => ({ find: () => Promise.resolve(stockLevels(10, 0)) }),
            };
            return {
                get: (token: unknown) => {
                    switch ((token as { name?: string })?.name) {
                        case 'TransactionalConnection':
                            return connection;
                        case 'GlobalSettingsService':
                            return {
                                getSettings: () => Promise.resolve({ outOfStockThreshold: 0 }),
                            };
                        case 'StockLevelService':
                            return { getLockedStockLevelsForVariant: lockedRead };
                        default:
                            return {};
                    }
                },
            } as any;
        }

        it('caps the allocation of a subclass whose init() override is synchronous', async () => {
            const lockedRead = vi.fn(() => Promise.resolve(stockLevels(10, 8)));
            const subclass = new SyncInitStockLocationStrategy();

            subclass.init(injectorReturning(lockedRead));

            expect(subclass.initReturnedVoid).toBe(true);
            const result = await subclass.forAllocation(ctx, [stockLocation], orderLine, 5);
            expect(lockedRead).toHaveBeenCalledTimes(1);
            expect(result).toEqual([{ location: stockLocation, quantity: 2, tracked: true }]);
        });

        it('names the missing call when a subclass does not call super.init()', async () => {
            const subclass = new NoSuperInitStockLocationStrategy();
            subclass.init(injectorReturning(() => Promise.resolve(stockLevels(10, 0))));

            const error = await subclass
                .forAllocation(ctx, [stockLocation], orderLine, 1)
                .catch((e: unknown) => e);

            expect(error).toBeInstanceOf(InternalServerError);
            expect((error as Error).message).toContain('must call super.init(injector)');
        });
    });
});
