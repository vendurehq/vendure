import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    ID,
    idsAreEqual,
    mergeConfig,
    Order,
    OrderService,
    OrderState,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    StockAdjustment,
    StockAllocationStrategy,
    StockLevel,
    StockLevelService,
    StockLocationService,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql, ResultOf } from './graphql/graphql-shop';
import { adminTransitionToStateDocument, updateProductVariantsDocument } from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getEligibleShippingMethodsDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
} from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * Regression tests for GHSA-8ghm-q833-cmgp (and the duplicate GHSA-9fhv-f6f9-5ggr).
 *
 * StockLevelService used a read-modify-write pattern to change `stockOnHand` and
 * `stockAllocated`. Two overlapping calls both read the same value and the second
 * write overwrote the first, so allocations were silently lost and the store could
 * oversell.
 *
 * The lost-update tests drive the service directly so that the interleaving is
 * deterministic on every database, including sqljs. Each call reads the row and then
 * writes it back, so starting all of the calls before any of them completes reproduces
 * the lost update exactly as the advisory describes.
 *
 * The locking tests need real concurrent transactions and `SELECT ... FOR UPDATE`, so
 * they only run on a database which supports row locks. sqljs supports neither.
 *
 * Two outcomes are accepted for a blocked second transaction, and both are asserted strictly:
 *
 *   - Postgres, MySQL, MariaDB before 11.6: the locking read waits, then returns the row version
 *     the first transaction committed, so the second transaction acts on fresh figures.
 *   - MariaDB 11.6 and later with `innodb_snapshot_isolation` on, which is the default: the
 *     locking read waits, then refuses with ER_CHECKREAD ("Record has changed since last read")
 *     and the server aborts the transaction. Nothing the second transaction did is committed.
 *
 * Either way the second transaction never acts on a stale read and never over-allocates, which is
 * the property under test. The second is a worse experience, not a weaker guarantee.
 */
const describeRowLocks = !process.env.DB || process.env.DB === 'sqljs' ? describe.skip : describe;

/**
 * The default StockAllocationStrategy allocates on the transition to PaymentAuthorized or
 * PaymentSettled, which is a separate request from the saleable stock check. A lock cannot
 * span two requests, so the check and the allocation are only serializable when they share a
 * transition. This strategy is the supported way to ask for that, and it is what the guard's
 * lock is there to protect.
 */
class AllocateOnCheckoutStrategy implements StockAllocationStrategy {
    shouldAllocateStock(ctx: RequestContext, fromState: OrderState, toState: OrderState, order: Order) {
        return fromState === 'AddingItems' && toState === 'ArrangingPayment';
    }
}

/**
 * The shared `transitionToStateDocument` does not select `__typename`, which this test needs in
 * order to tell an Order apart from an OrderStateTransitionError without inspecting field shapes.
 */
const transitionToArrangingPaymentDocument = graphql(`
    mutation StockRaceTransitionToState($state: String!) {
        transitionOrderToState(state: $state) {
            __typename
            ... on Order {
                id
                state
            }
            ... on OrderStateTransitionError {
                errorCode
                message
                transitionError
            }
        }
    }
`);

type TransitionResult = NonNullable<
    ResultOf<typeof transitionToArrangingPaymentDocument>['transitionOrderToState']
>;

function isTransitionError(
    result: TransitionResult,
): result is Extract<TransitionResult, { __typename: 'OrderStateTransitionError' }> {
    return result.__typename === 'OrderStateTransitionError';
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => (resolve = r));
    return { promise, resolve };
}

describe('StockLevelService concurrency', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
            orderOptions: {
                stockAllocationStrategy: new AllocateOnCheckoutStrategy(),
            },
        }),
    );

    let ctx: RequestContext;
    let connection: TransactionalConnection;
    let stockLevelService: StockLevelService;
    let productVariantService: ProductVariantService;
    let stockMovementService: StockMovementService;
    let requestContextService: RequestContextService;
    let productVariantId: ID;
    let stockLocationId: ID;

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        requestContextService = server.app.get(RequestContextService);
        ctx = await requestContextService.create({ apiType: 'admin' });
        connection = server.app.get(TransactionalConnection);
        stockLevelService = server.app.get(StockLevelService);
        productVariantService = server.app.get(ProductVariantService);
        stockMovementService = server.app.get(StockMovementService);
        const defaultStockLocation = await server.app.get(StockLocationService).defaultStockLocation(ctx);
        stockLocationId = defaultStockLocation.id;
        productVariantId = 1;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function setStockLevel(stockOnHand: number, stockAllocated: number, variantId = productVariantId) {
        const stockLevel = await stockLevelService.getStockLevel(ctx, variantId, stockLocationId);
        await connection.getRepository(ctx, StockLevel).update(stockLevel.id, {
            stockOnHand,
            stockAllocated,
        });
    }

    async function getStockLevel(variantId = productVariantId) {
        return stockLevelService.getStockLevel(ctx, variantId, stockLocationId);
    }

    /**
     * The sum of every StockAdjustment recorded against the variant. `stockOnHand` is only
     * explained by the ledger when this sum accounts for the difference from the starting value.
     */
    async function stockAdjustmentTotal(variantId: ID) {
        const adjustments = await connection
            .getRepository(ctx, StockAdjustment)
            // StockMovement has no `productVariantId` column property, only the relation.
            .find({ where: { productVariant: { id: variantId } } });
        return adjustments.reduce((total, adjustment) => total + adjustment.quantity, 0);
    }

    describe('lost updates', () => {
        beforeEach(async () => {
            await setStockLevel(10, 0);
        });

        it('concurrent updateStockAllocatedForLocation calls do not lose updates', async () => {
            await Promise.all(
                Array.from({ length: 5 }).map(() =>
                    stockLevelService.updateStockAllocatedForLocation(
                        ctx,
                        productVariantId,
                        stockLocationId,
                        1,
                    ),
                ),
            );

            const stockLevel = await getStockLevel();
            expect(stockLevel.stockAllocated).toBe(5);
            expect(stockLevel.stockOnHand).toBe(10);
        });

        it('concurrent updateStockOnHandForLocation calls do not lose updates', async () => {
            await Promise.all(
                Array.from({ length: 5 }).map(() =>
                    stockLevelService.updateStockOnHandForLocation(
                        ctx,
                        productVariantId,
                        stockLocationId,
                        -1,
                    ),
                ),
            );

            const stockLevel = await getStockLevel();
            expect(stockLevel.stockOnHand).toBe(5);
            expect(stockLevel.stockAllocated).toBe(0);
        });

        it('interleaved allocation and sale updates are both applied', async () => {
            // Start above 0 so that no ordering of the three updates takes stockAllocated below 0.
            // If the -1 landed first on 0, the clamp would lift it back to 0 and cancel it, and
            // the result would depend on the order the database applied them in.
            await setStockLevel(10, 1);
            await Promise.all([
                stockLevelService.updateStockAllocatedForLocation(ctx, productVariantId, stockLocationId, 3),
                stockLevelService.updateStockOnHandForLocation(ctx, productVariantId, stockLocationId, -3),
                stockLevelService.updateStockAllocatedForLocation(ctx, productVariantId, stockLocationId, -1),
            ]);

            const stockLevel = await getStockLevel();
            expect(stockLevel.stockAllocated).toBe(3);
            expect(stockLevel.stockOnHand).toBe(7);
        });

        it('sequential updates still apply the change to the stored value', async () => {
            await stockLevelService.updateStockAllocatedForLocation(
                ctx,
                productVariantId,
                stockLocationId,
                4,
            );
            await stockLevelService.updateStockOnHandForLocation(ctx, productVariantId, stockLocationId, 2);

            const stockLevel = await getStockLevel();
            expect(stockLevel.stockAllocated).toBe(4);
            expect(stockLevel.stockOnHand).toBe(12);
        });

        it('updateStockOnHandForLocation creates the StockLevel row when it is missing', async () => {
            const otherVariantId = 2;
            await connection
                .getRepository(ctx, StockLevel)
                .delete({ productVariantId: otherVariantId, stockLocationId });

            await stockLevelService.updateStockOnHandForLocation(ctx, otherVariantId, stockLocationId, 7);

            const stockLevel = await stockLevelService.getStockLevel(ctx, otherVariantId, stockLocationId);
            expect(stockLevel.stockOnHand).toBe(7);
            expect(stockLevel.stockAllocated).toBe(0);
        });
    });

    // These need `SELECT ... FOR UPDATE` and two transactions running at the same time.
    describeRowLocks('check-then-allocate window (row locks)', () => {
        // Both variants come from fixtures/e2e-products-stock-control.csv: the two Curvy Monitor
        // variants, which no other test in this file touches.
        const lockTestVariantId = 5;
        const checkoutVariantId = 6;

        async function trackInventoryFor(variantId: ID) {
            await connection
                .getRepository(ctx, ProductVariant)
                .update(variantId, { trackInventory: GlobalFlag.TRUE });
        }

        it('a second transaction waits for the first to commit before reading saleable stock', async () => {
            await trackInventoryFor(lockTestVariantId);
            await setStockLevel(10, 0, lockTestVariantId);
            const variant = await connection
                .getRepository(ctx, ProductVariant)
                .findOneOrFail({ where: { id: lockTestVariantId } });

            const firstHasLocked = deferred();
            const firstMayCommit = deferred();
            let firstObserved: number | undefined;
            let secondObserved: number | undefined;

            const firstTransaction = connection.withTransaction(
                await requestContextService.create({ apiType: 'admin' }),
                async txCtx => {
                    firstObserved = await productVariantService.getSaleableStockLevel(txCtx, variant, {
                        lockStockLevels: true,
                    });
                    firstHasLocked.resolve();
                    await firstMayCommit.promise;
                    await stockLevelService.updateStockAllocatedForLocation(
                        txCtx,
                        lockTestVariantId,
                        stockLocationId,
                        1,
                    );
                },
            );

            await firstHasLocked.promise;

            let secondError: Error | undefined;
            const secondTransaction = connection
                .withTransaction(await requestContextService.create({ apiType: 'admin' }), async txCtx => {
                    secondObserved = await productVariantService.getSaleableStockLevel(txCtx, variant, {
                        lockStockLevels: true,
                    });
                    await stockLevelService.updateStockAllocatedForLocation(
                        txCtx,
                        lockTestVariantId,
                        stockLocationId,
                        1,
                    );
                })
                .catch((e: Error) => {
                    secondError = e;
                });

            // There is no signal a JS caller can await for "the second transaction is now
            // blocked inside the database", so a fixed wait is the only synchronisation point
            // available. One second is far longer than the second transaction needs to reach
            // the locking read. Known limitation: on a runner slower than that, the transaction
            // may not have reached the read yet, and the assertion below passes without proving
            // the block happened.
            await new Promise(resolve => setTimeout(resolve, 1000));
            expect(secondObserved).toBeUndefined();

            firstMayCommit.resolve();
            await Promise.all([firstTransaction, secondTransaction]);

            expect(firstObserved).toBe(10);
            const stockAllocated = (await getStockLevel(lockTestVariantId)).stockAllocated;
            if (secondError) {
                // MariaDB 11.6+ snapshot isolation. The read is refused and the transaction is
                // aborted, so the second allocation never lands.
                expect(process.env.DB, 'driver abort accepted only on MariaDB').toBe('mariadb');
                expect(secondError.message).toContain('Record has changed since last read');
                expect(secondObserved).toBeUndefined();
                expect(stockAllocated).toBe(1);
            } else {
                // Without the lock the second transaction would also have read 10.
                expect(secondObserved).toBe(9);
                expect(stockAllocated).toBe(2);
            }
        });

        it('two concurrent checkouts for the last unit produce exactly one order', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: `T_${String(checkoutVariantId)}`,
                        trackInventory: GlobalFlag.TRUE,
                        stockOnHand: 1,
                        outOfStockThreshold: 0,
                        useGlobalOutOfStockThreshold: false,
                    },
                ],
            });
            await setStockLevel(1, 0, checkoutVariantId);

            const config = testConfig();
            // Only the URL is taken from this config; the running server is the one built above.
            const shopApiUrl = `http://localhost:${String(config.apiOptions.port)}/${String(
                config.apiOptions.shopApiPath,
            )}`;
            const clients: SimpleGraphQLClient[] = [];
            for (let i = 0; i < 2; i++) {
                const client = new SimpleGraphQLClient(config, shopApiUrl);
                await client.asAnonymousUser();
                await client.query(addItemToOrderDocument, {
                    productVariantId: `T_${String(checkoutVariantId)}`,
                    quantity: 1,
                });
                await client.query(setCustomerDocument, {
                    input: {
                        emailAddress: `stock-race-${String(i)}@test.com`,
                        firstName: 'Stock',
                        lastName: `Race ${String(i)}`,
                    },
                });
                await client.query(setShippingAddressDocument, {
                    input: {
                        fullName: 'name',
                        streetLine1: '12 the street',
                        city: 'foo',
                        postalCode: '123456',
                        countryCode: 'US',
                    },
                });
                const { eligibleShippingMethods } = await client.query(getEligibleShippingMethodsDocument);
                await client.query(setShippingMethodDocument, {
                    id: [eligibleShippingMethods[0].id],
                });
                clients.push(client);
            }

            const outcomes = await Promise.all(
                clients.map(client =>
                    client
                        .query(transitionToArrangingPaymentDocument, { state: 'ArrangingPayment' })
                        .then(r => ({ result: r.transitionOrderToState as TransitionResult }))
                        // On MariaDB 11.6+ the aborted transaction also discards the savepoint
                        // TypeORM opened for the nested transaction, so the request fails at the
                        // driver level instead of returning a transition error. The order still
                        // does not transition and no stock is allocated.
                        .catch((error: Error) => ({ error })),
                ),
            );

            const succeeded = outcomes.filter(
                (o): o is { result: TransitionResult } =>
                    'result' in o && o.result != null && !isTransitionError(o.result),
            );
            const rejectedCleanly = outcomes.filter(
                (o): o is { result: TransitionResult } =>
                    'result' in o && o.result != null && isTransitionError(o.result),
            );
            const rejectedByDriver = outcomes.filter(
                (o): o is { error: Error } => 'error' in o && o.error != null,
            );

            expect(succeeded.length).toBe(1);
            expect((succeeded[0].result as { state: string }).state).toBe('ArrangingPayment');
            expect(rejectedCleanly.length + rejectedByDriver.length).toBe(1);
            for (const rejected of rejectedCleanly) {
                const error = rejected.result as Extract<
                    TransitionResult,
                    { __typename: 'OrderStateTransitionError' }
                >;
                expect(error.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
                expect(error.transitionError).toContain('insufficient stock');
            }
            for (const rejected of rejectedByDriver) {
                expect(process.env.DB, 'driver abort accepted only on MariaDB').toBe('mariadb');
                expect(rejected.error.message).toMatch(
                    /Record has changed since last read|SAVEPOINT .* does not exist/,
                );
            }

            // The invariant, whichever way the second checkout was rejected.
            const stockLevel = await getStockLevel(checkoutVariantId);
            expect(stockLevel.stockAllocated).toBe(1);
            expect(stockLevel.stockOnHand).toBe(1);
        });

        // `modifyOrder` runs on an order which is already placed, so it allocates synchronously
        // in the same transaction, with any StockAllocationStrategy. Its saleable-stock check
        // must therefore hold the row lock. Both orders below hold one allocated unit of a
        // variant with three on hand, and both modifications then try to claim the single
        // remaining saleable unit.
        it('two concurrent order modifications cannot allocate past the saleable stock', async () => {
            const modifyVariantId = 7;
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: `T_${String(modifyVariantId)}`,
                        trackInventory: GlobalFlag.TRUE,
                        stockOnHand: 3,
                        outOfStockThreshold: 0,
                        useGlobalOutOfStockThreshold: false,
                    },
                ],
            });

            const config = testConfig();
            // Only the URL is taken from this config; the running server is the one built above.
            const shopApiUrl = `http://localhost:${String(config.apiOptions.port)}/${String(
                config.apiOptions.shopApiPath,
            )}`;
            const rawOrderIds: number[] = [];
            for (let i = 0; i < 2; i++) {
                const client = new SimpleGraphQLClient(config, shopApiUrl);
                await client.asAnonymousUser();
                await client.query(addItemToOrderDocument, {
                    productVariantId: `T_${String(modifyVariantId)}`,
                    quantity: 1,
                });
                await client.query(setCustomerDocument, {
                    input: {
                        emailAddress: `modify-race-${String(i)}@test.com`,
                        firstName: 'Modify',
                        lastName: `Race ${String(i)}`,
                    },
                });
                const orderId = await proceedToArrangingPayment(client, 0);
                await addPaymentToOrder(client, testSuccessfulPaymentMethod);
                const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                    id: String(orderId),
                    state: 'Modifying',
                });
                expect((transitionOrderToState as { state?: string }).state).toBe('Modifying');
                rawOrderIds.push(Number(String(orderId).replace('T_', '')));
            }
            // Each checkout allocated one unit, so one of the three on hand is still saleable.
            expect((await getStockLevel(modifyVariantId)).stockAllocated).toBe(2);

            const orderService = server.app.get(OrderService);
            const orderLineIds: ID[] = [];
            for (const orderId of rawOrderIds) {
                const order = await orderService.findOne(ctx, orderId, ['lines']);
                if (!order) {
                    throw new Error(`Order ${String(orderId)} not found`);
                }
                orderLineIds.push(order.lines[0].id);
            }

            const firstModified = deferred();
            const firstMayCommit = deferred();
            let firstResult: { errorCode?: string } | undefined;
            const firstTransaction = connection.withTransaction(
                await requestContextService.create({ apiType: 'admin' }),
                async txCtx => {
                    firstResult = await orderService.modifyOrder(txCtx, {
                        dryRun: false,
                        orderId: rawOrderIds[0],
                        adjustOrderLines: [{ orderLineId: orderLineIds[0], quantity: 2 }],
                    });
                    firstModified.resolve();
                    await firstMayCommit.promise;
                },
            );
            await firstModified.promise;

            let secondResult: { errorCode?: string; quantityAvailable?: number } | undefined;
            let secondError: Error | undefined;
            const secondTransaction = connection
                .withTransaction(await requestContextService.create({ apiType: 'admin' }), async txCtx => {
                    secondResult = await orderService.modifyOrder(txCtx, {
                        dryRun: false,
                        orderId: rawOrderIds[1],
                        adjustOrderLines: [{ orderLineId: orderLineIds[1], quantity: 2 }],
                    });
                })
                .catch((e: Error) => {
                    secondError = e;
                });

            // See the comment in the first row-lock test for why one second, and for the
            // limitation of a fixed wait.
            await new Promise(resolve => setTimeout(resolve, 1000));
            expect(secondResult).toBeUndefined();

            firstMayCommit.resolve();
            await Promise.all([firstTransaction, secondTransaction]);

            expect(firstResult).toBeDefined();
            expect(firstResult?.errorCode).toBeUndefined();
            if (secondError) {
                // MariaDB 11.6+ snapshot isolation. The locking read is refused and the
                // transaction is aborted, so the second modification never allocates.
                expect(process.env.DB, 'driver abort accepted only on MariaDB').toBe('mariadb');
                expect(secondError.message).toContain('Record has changed since last read');
            } else {
                // The second modification waited for the first to commit, re-read the fresh
                // figures, and was refused cleanly.
                expect(secondResult?.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
                expect(secondResult?.quantityAvailable).toBe(1);
            }

            // Without the lock both modifications pass the check and stockAllocated ends at 4,
            // one more than stockOnHand.
            const stockLevel = await getStockLevel(modifyVariantId);
            expect(stockLevel.stockOnHand).toBe(3);
            expect(stockLevel.stockAllocated).toBe(3);
        });
    });

    /**
     * The admin stock APIs take an absolute `stockOnHand`, but the statement which applies it is the
     * relative `stockOnHand + delta` that the atomic-write fix introduced. The delta is only correct
     * if the value it is derived from was read under the row lock, and that read must be the locking
     * one: on MySQL and MariaDB a plain SELECT under REPEATABLE READ returns the transaction's
     * opening snapshot, so a transaction which waited on the lock would still compute its delta from
     * the value from before the other adjustment committed.
     *
     * Both variants here are the two Laptop variants which no other test in this file touches.
     */
    describe('absolute stock adjustments', () => {
        const adjustVariantId = 3;
        const secondAdjustVariantId = 4;

        async function setUpVariants(variantIds: number[], stockOnHand: number, trackInventory: GlobalFlag) {
            await adminClient.query(updateProductVariantsDocument, {
                input: variantIds.map(id => ({
                    id: `T_${String(id)}`,
                    trackInventory,
                    stockOnHand,
                    outOfStockThreshold: 0,
                    useGlobalOutOfStockThreshold: false,
                })),
            });
            for (const variantId of variantIds) {
                await setStockLevel(stockOnHand, 0, variantId);
            }
        }

        // Runs on every driver: the lock order is the sequence of calls, which is the same whether
        // or not the driver can actually take the lock.
        //
        // Both variants are left untracked on purpose. The order paths skip untracked variants when
        // they lock, because an untracked variant has no saleable stock to check. An absolute
        // adjustment still derives its delta from the current `stockOnHand`, so it has to lock them.
        // Without that, the only locks taken here would be the per-variant reads inside each
        // adjustment, in input order, which is the deadlock this test guards against.
        it('a bulk update locks every adjusted variant up front, in ascending id order', async () => {
            await setUpVariants([adjustVariantId, secondAdjustVariantId], 10, GlobalFlag.FALSE);

            const lockedIds: string[] = [];
            const lockStockLevels = stockLevelService.getLockedStockLevelsForVariant.bind(stockLevelService);
            const lockSpy = vi
                .spyOn(stockLevelService, 'getLockedStockLevelsForVariant')
                .mockImplementation((lockCtx, lockedVariantId) => {
                    lockedIds.push(String(lockedVariantId));
                    return lockStockLevels(lockCtx, lockedVariantId);
                });
            try {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        { id: `T_${String(secondAdjustVariantId)}`, stockOnHand: 21 },
                        { id: `T_${String(adjustVariantId)}`, stockOnHand: 22 },
                    ],
                });
            } finally {
                lockSpy.mockRestore();
            }

            // The first two locks are the up-front ones, in ascending id order even though the
            // input lists the variants in descending order. The locked read inside each adjustment
            // follows, and meets rows this transaction already holds.
            expect(lockedIds.slice(0, 2)).toEqual([String(adjustVariantId), String(secondAdjustVariantId)]);
            expect((await getStockLevel(adjustVariantId)).stockOnHand).toBe(22);
            expect((await getStockLevel(secondAdjustVariantId)).stockOnHand).toBe(21);
        });

        it('a variant whose stock the update does not touch is not locked', async () => {
            await setUpVariants([adjustVariantId, secondAdjustVariantId], 10, GlobalFlag.FALSE);

            const lockedIds: string[] = [];
            const lockStockLevels = stockLevelService.getLockedStockLevelsForVariant.bind(stockLevelService);
            const lockSpy = vi
                .spyOn(stockLevelService, 'getLockedStockLevelsForVariant')
                .mockImplementation((lockCtx, lockedVariantId) => {
                    lockedIds.push(String(lockedVariantId));
                    return lockStockLevels(lockCtx, lockedVariantId);
                });
            try {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        { id: `T_${String(adjustVariantId)}`, stockOnHand: 23 },
                        // No stock in this one, so locking it would only make an unrelated
                        // settlement of it wait for this request.
                        { id: `T_${String(secondAdjustVariantId)}`, outOfStockThreshold: 1 },
                    ],
                });
            } finally {
                lockSpy.mockRestore();
            }

            expect(lockedIds).not.toContain(String(secondAdjustVariantId));
            expect(lockedIds).toContain(String(adjustVariantId));
        });

        // These need `SELECT ... FOR UPDATE` and two transactions running at the same time.
        describeRowLocks('row locks', () => {
            it('two concurrent absolute stockOnHand updates end at one of the two requested values', async () => {
                await setUpVariants([adjustVariantId], 10, GlobalFlag.FALSE);
                const ledgerBefore = await stockAdjustmentTotal(adjustVariantId);

                const firstAdjusted = deferred();
                const firstMayCommit = deferred();
                let secondFinished = false;

                const firstTransaction = connection.withTransaction(
                    await requestContextService.create({ apiType: 'admin' }),
                    async txCtx => {
                        await stockMovementService.adjustProductVariantStock(txCtx, adjustVariantId, 15);
                        firstAdjusted.resolve();
                        await firstMayCommit.promise;
                    },
                );
                await firstAdjusted.promise;

                let secondError: Error | undefined;
                const secondTransaction = connection
                    .withTransaction(
                        await requestContextService.create({ apiType: 'admin' }),
                        async txCtx => {
                            await stockMovementService.adjustProductVariantStock(txCtx, adjustVariantId, 12);
                            secondFinished = true;
                        },
                    )
                    .catch((e: Error) => {
                        secondError = e;
                    });

                // See the comment in the first row-lock test for why one second, and for the
                // limitation of a fixed wait. Without the locked read the second adjustment does
                // not wait here at all: it reads the uncommitted-elsewhere 10, derives +2 from it
                // and finishes.
                await new Promise(resolve => setTimeout(resolve, 1000));
                expect(secondFinished).toBe(false);

                firstMayCommit.resolve();
                await Promise.all([firstTransaction, secondTransaction]);

                const stockLevel = await getStockLevel(adjustVariantId);
                const ledgerAfter = await stockAdjustmentTotal(adjustVariantId);
                if (secondError) {
                    // MariaDB 11.6+ snapshot isolation. The locking read is refused and the second
                    // transaction is aborted, so the first admin's value is the one that stands.
                    expect(process.env.DB, 'driver abort accepted only on MariaDB').toBe('mariadb');
                    expect(secondError.message).toContain('Record has changed since last read');
                    expect(stockLevel.stockOnHand).toBe(15);
                } else {
                    // The later admin's value. Before the fix both adjustments derived their delta
                    // from the same read of 10 and the stored value was 10 + 5 + 2 = 17, which is
                    // neither of the values either admin asked for.
                    expect(stockLevel.stockOnHand).toBe(12);
                }
                // Whichever way it resolved, the ledger accounts for the stored value exactly.
                expect(10 + ledgerAfter - ledgerBefore).toBe(stockLevel.stockOnHand);
            });

            // Problem 1: the bulk update walks the variants in input order. A settlement locks them
            // in ascending id order. With the two orders opposed, each transaction ends up waiting
            // for a row the other holds and the database aborts one of them. The up-front lock makes
            // the bulk update take the same order, so the settlement simply waits.
            it('a bulk stock update does not deadlock with a concurrent settlement of the same variants', async () => {
                await setUpVariants([adjustVariantId, secondAdjustVariantId], 50, GlobalFlag.TRUE);

                const config = testConfig();
                // Only the URL is taken from this config; the running server is the one built above.
                const shopApiUrl = `http://localhost:${String(config.apiOptions.port)}/${String(
                    config.apiOptions.shopApiPath,
                )}`;
                const client = new SimpleGraphQLClient(config, shopApiUrl);
                await client.asAnonymousUser();
                for (const variantId of [adjustVariantId, secondAdjustVariantId]) {
                    await client.query(addItemToOrderDocument, {
                        productVariantId: `T_${String(variantId)}`,
                        quantity: 1,
                    });
                }
                await client.query(setCustomerDocument, {
                    input: {
                        emailAddress: 'deadlock-race@test.com',
                        firstName: 'Deadlock',
                        lastName: 'Race',
                    },
                });
                const orderId = await proceedToArrangingPayment(client, 0);
                const order = await server.app
                    .get(OrderService)
                    .findOne(ctx, Number(String(orderId).replace('T_', '')), ['lines']);
                if (!order) {
                    throw new Error('Order not found');
                }
                const orderLineFor = (variantId: number) => {
                    const line = order.lines.find(l => idsAreEqual(l.productVariantId, variantId));
                    if (!line) {
                        throw new Error(`No OrderLine for ProductVariant ${String(variantId)}`);
                    }
                    return { orderLineId: line.id, quantity: 1 };
                };

                // Let the bulk update take its first lock, then start the settlement, so that the
                // two are provably interleaved rather than merely started at the same time.
                const updateTookFirstLock = deferred();
                const updateMayProceed = deferred();
                let armed = true;
                const lockStockLevels =
                    stockLevelService.getLockedStockLevelsForVariant.bind(stockLevelService);
                const lockSpy = vi
                    .spyOn(stockLevelService, 'getLockedStockLevelsForVariant')
                    .mockImplementation(async (lockCtx, lockedVariantId) => {
                        const stockLevels = await lockStockLevels(lockCtx, lockedVariantId);
                        // The bulk update below lists the higher id first, so without the up-front
                        // lock this is its first lock and the lower id is still free for the
                        // settlement to take. With it, the lower id is already held here.
                        if (armed && idsAreEqual(lockedVariantId, secondAdjustVariantId)) {
                            armed = false;
                            updateTookFirstLock.resolve();
                            await updateMayProceed.promise;
                        }
                        return stockLevels;
                    });

                let updateError: Error | undefined;
                let settlementError: Error | undefined;
                let settlementFinished = false;
                try {
                    const bulkUpdate = connection
                        .withTransaction(
                            await requestContextService.create({ apiType: 'admin' }),
                            async txCtx => {
                                await productVariantService.update(txCtx, [
                                    { id: secondAdjustVariantId, stockOnHand: 20 },
                                    { id: adjustVariantId, stockOnHand: 30 },
                                ]);
                            },
                        )
                        .catch((e: Error) => {
                            updateError = e;
                        });
                    await updateTookFirstLock.promise;

                    const settlement = connection
                        .withTransaction(
                            await requestContextService.create({ apiType: 'admin' }),
                            async txCtx => {
                                await stockMovementService.createSalesForOrder(txCtx, [
                                    orderLineFor(adjustVariantId),
                                    orderLineFor(secondAdjustVariantId),
                                ]);
                                settlementFinished = true;
                            },
                        )
                        .catch((e: Error) => {
                            settlementError = e;
                        });

                    // See the comment in the first row-lock test for why one second. The bulk
                    // update holds both variants, so the settlement cannot have got past its lock.
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    expect(settlementFinished).toBe(false);

                    updateMayProceed.resolve();
                    await Promise.all([bulkUpdate, settlement]);
                } finally {
                    updateMayProceed.resolve();
                    lockSpy.mockRestore();
                }

                // The property under test. Without the up-front lock the two transactions take the
                // same two row locks in opposite order, and the database aborts one of them.
                for (const error of [updateError, settlementError]) {
                    expect(
                        error?.message ?? '',
                        'neither transaction may be aborted for a deadlock',
                    ).not.toContain('deadlock');
                }
                if (settlementError) {
                    // MariaDB 11.6+ snapshot isolation refuses the settlement's locking read of a
                    // row the bulk update changed, and aborts it. No deadlock, and no stock written.
                    expect(process.env.DB, 'driver abort accepted only on MariaDB').toBe('mariadb');
                    expect(settlementError.message).toContain('Record has changed since last read');
                } else {
                    expect((await getStockLevel(adjustVariantId)).stockOnHand).toBe(29);
                    expect((await getStockLevel(secondAdjustVariantId)).stockOnHand).toBe(19);
                    expect((await getStockLevel(adjustVariantId)).stockAllocated).toBe(0);
                    expect((await getStockLevel(secondAdjustVariantId)).stockAllocated).toBe(0);
                }
                expect(updateError).toBeUndefined();
            });
        });
    });
});
