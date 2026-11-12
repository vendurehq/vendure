import { Injectable } from '@nestjs/common';
import {
    OrderLineInput,
    StockLevelInput,
    StockMovementListOptions,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { FindOptionsWhere, In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { idsAreEqual } from '../../common/utils';
import { Logger } from '../../config/logger/vendure-logger';
import { ShippingCalculator } from '../../config/shipping-method/shipping-calculator';
import { ShippingEligibilityChecker } from '../../config/shipping-method/shipping-eligibility-checker';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { Order } from '../../entity/order/order.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';
import { Allocation } from '../../entity/stock-movement/allocation.entity';
import { Cancellation } from '../../entity/stock-movement/cancellation.entity';
import { Release } from '../../entity/stock-movement/release.entity';
import { Sale } from '../../entity/stock-movement/sale.entity';
import { StockAdjustment } from '../../entity/stock-movement/stock-adjustment.entity';
import { StockMovement } from '../../entity/stock-movement/stock-movement.entity';
import { EventBus } from '../../event-bus/event-bus';
import { StockMovementEvent } from '../../event-bus/events/stock-movement-event';
import { StockShortfall, StockShortfallEvent } from '../../event-bus/events/stock-shortfall-event';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';
import { getOrderChannelContext } from '../helpers/utils/order-channel-context';

import { ChannelService } from './channel.service';
import { StockLevelService } from './stock-level.service';
import { StockLocationService } from './stock-location.service';

const loggerCtx = 'StockMovementService';

interface LineMovements {
    allocations: Allocation[];
    releases: Release[];
    sales: Sale[];
    cancellations: Cancellation[];
}

/**
 * @description
 * Contains methods relating to {@link StockMovement} entities.
 *
 * @docsCategory services
 */
@Injectable()
@Instrument()
export class StockMovementService {
    shippingEligibilityCheckers: ShippingEligibilityChecker[];
    shippingCalculators: ShippingCalculator[];
    private activeShippingMethods: ShippingMethod[];

    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private stockLevelService: StockLevelService,
        private eventBus: EventBus,
        private stockLocationService: StockLocationService,
    ) {}

    /**
     * @description
     * Returns a {@link PaginatedList} of all StockMovements associated with the specified ProductVariant.
     */
    getStockMovementsByProductVariantId(
        ctx: RequestContext,
        productVariantId: ID,
        options?: StockMovementListOptions,
    ): Promise<PaginatedList<StockMovement>> {
        const qb = this.listQueryBuilder
            .build<StockMovement>(StockMovement as any, options, { ctx })
            .leftJoin('stockmovement.productVariant', 'productVariant')
            .andWhere('productVariant.id = :productVariantId', { productVariantId });

        if (options?.type) {
            qb.andWhere('stockmovement.type = :type', { type: options.type });
        }

        return qb.getManyAndCount().then(([items, totalItems]) => ({
            items,
            totalItems,
        }));
    }

    /**
     * @description
     * Adjusts the stock level of the ProductVariant, creating a new {@link StockAdjustment} entity
     * in the process.
     *
     * The `stockOnHand` of the input is absolute, but the write which applies it is a relative
     * `stockOnHand + delta`, so the current value is read under a write lock held until the
     * surrounding transaction commits. Two concurrent adjustments of the same ProductVariant
     * therefore serialize, and the stored value is the one the later of the two asked for.
     *
     * When adjusting more than one ProductVariant in a transaction, call
     * {@link StockLevelService.lockStockLevelsForVariants} for the whole set first, with
     * `{ includeUntrackedVariants: true }`, so the locks are taken in the shared order.
     */
    async adjustProductVariantStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockOnHandNumberOrInput: number | StockLevelInput[],
    ): Promise<StockAdjustment[]> {
        // Run inside a transaction for the same reason as `createAllocationsForOrderLines`: the
        // locked read below needs one, and a caller from a non-transactional context (the
        // FastImporterService, a job-queue processor, a stand-alone script) would otherwise fall
        // back to an unlocked read. It also makes the StockAdjustment ledger row and the StockLevel
        // write atomic. Nested transactions join the existing one, so the `@Transaction()`-wrapped
        // API paths are unaffected.
        return this.connection.withTransaction(ctx, async txCtx => {
            let stockOnHandInputs: StockLevelInput[];
            if (typeof stockOnHandNumberOrInput === 'number') {
                const defaultStockLocation = await this.stockLocationService.defaultStockLocation(txCtx);
                stockOnHandInputs = [
                    { stockLocationId: defaultStockLocation.id, stockOnHand: stockOnHandNumberOrInput },
                ];
            } else {
                stockOnHandInputs = stockOnHandNumberOrInput;
            }
            // One locked read for every location of this variant, before the first delta is
            // computed. It must be the locking read rather than a plain one: on MySQL and MariaDB a
            // plain SELECT under REPEATABLE READ returns the transaction's opening snapshot, which
            // for a transaction that waited on the lock is the value from before the other
            // adjustment committed.
            const lockedStockLevels = await this.stockLevelService.getLockedStockLevelsForVariant(
                txCtx,
                productVariantId,
            );
            // Keyed by stock location, so that two inputs for the same location in one call each
            // apply their delta to the value the previous one produced, rather than both to the
            // value read above.
            const stockOnHandByLocation = new Map<string, number>(
                lockedStockLevels.map(level => [String(level.stockLocationId), level.stockOnHand]),
            );
            const adjustments: StockAdjustment[] = [];
            for (const input of stockOnHandInputs) {
                const locationKey = String(input.stockLocationId);
                if (!stockOnHandByLocation.has(locationKey)) {
                    // No row for this location yet, so there is nothing to lock and nothing stale.
                    // `getStockLevel` creates it with a `stockOnHand` of 0.
                    const created = await this.stockLevelService.getStockLevel(
                        txCtx,
                        productVariantId,
                        input.stockLocationId,
                    );
                    stockOnHandByLocation.set(locationKey, created.stockOnHand);
                }
                if (input.trackInventory != null) {
                    await this.connection
                        .getRepository(txCtx, StockLevel)
                        .update(
                            { productVariantId, stockLocationId: input.stockLocationId },
                            { trackInventory: input.trackInventory },
                        );
                }
                if (input.stockOnHand == null) {
                    // Only the tracking setting changes; there is no stock to adjust.
                    continue;
                }
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const oldStockLevel = stockOnHandByLocation.get(locationKey)!;
                const newStockLevel = input.stockOnHand;
                if (oldStockLevel === newStockLevel) {
                    continue;
                }
                const delta = newStockLevel - oldStockLevel;
                stockOnHandByLocation.set(locationKey, newStockLevel);
                const adjustment = await this.connection.getRepository(txCtx, StockAdjustment).save(
                    new StockAdjustment({
                        // An adjustment always changes stockOnHand, whatever the tracking setting.
                        tracked: true,
                        quantity: delta,
                        stockLocation: { id: input.stockLocationId },
                        productVariant: { id: productVariantId },
                    }),
                );
                await this.stockLevelService.updateStockOnHandForLocation(
                    txCtx,
                    productVariantId,
                    input.stockLocationId,
                    delta,
                );
                await this.eventBus.publish(new StockMovementEvent(txCtx, [adjustment]));
                adjustments.push(adjustment);
            }

            return adjustments;
        });
    }

    /**
     * @description
     * Creates a new {@link Allocation} for each OrderLine in the Order. For ProductVariants
     * which are configured to track stock levels, the `ProductVariant.stockAllocated` value is
     * increased, indicating that this quantity of stock is allocated and cannot be sold.
     */
    async createAllocationsForOrder(ctx: RequestContext, order: Order): Promise<Allocation[]> {
        const lines = order.lines.map(orderLine => ({
            orderLineId: orderLine.id,
            quantity: orderLine.quantity,
        }));
        return this.createAllocationsForOrderLines(ctx, lines);
    }

    /**
     * @description
     * Creates a new {@link Allocation} for each of the given OrderLines. For ProductVariants
     * which are configured to track stock levels, the `ProductVariant.stockAllocated` value is
     * increased, indicating that this quantity of stock is allocated and cannot be sold.
     */
    async createAllocationsForOrderLines(
        ctx: RequestContext,
        lines: OrderLineInput[],
    ): Promise<Allocation[]> {
        // Run inside a transaction so that the per-variant pessimistic locks taken during
        // allocation (see MultiChannelStockLocationStrategy.forAllocation) are valid and held until
        // commit. Without this, a caller from a non-transactional context (a job-queue processor or
        // a stand-alone script calling e.g. `orderService.transitionToState`) would trigger
        // TypeORM's `PessimisticLockTransactionRequiredError` on every driver. Nested transactions
        // join the existing one, so the core API paths (already `@Transaction`-wrapped) are unaffected.
        return this.connection.withTransaction(ctx, async txCtx => {
            const allocations: Allocation[] = [];
            // A single batch can contain lines from more than one Order: `Fulfillment.orders` is a
            // many-to-many relation and `default-fulfillment-process` re-allocates a cancelled
            // fulfillment's lines in one call. Shortfalls are therefore grouped by the Order the
            // shortfalling line belongs to, so each StockShortfallEvent references the right Order.
            const shortfallsByOrder = new Map<ID, { order: Order; shortfalls: StockShortfall[] }>();
            const orderContexts = new Map<string, RequestContext>();
            const ledgerCache = new Map<string, LineMovements>();
            const orderLinesToAllocate = await Promise.all(
                lines.map(async ({ orderLineId, quantity }) => ({
                    orderLine: await this.connection.getEntityOrThrow(txCtx, OrderLine, orderLineId, {
                        relations: ['order'],
                    }),
                    quantity,
                })),
            );
            // Lock the variants which are tracked in the Channel of the Order they are allocated
            // for, which need not be the Channel of whoever triggered the allocation. One sorted
            // lock call for the whole batch keeps the shared lock order.
            const trackedVariantIds: ID[] = [];
            for (const { orderLine } of orderLinesToAllocate) {
                const orderCtx = await this.getOrderContext(txCtx, orderLine.order.id, orderContexts);
                trackedVariantIds.push(
                    ...(await this.stockLevelService.getTrackedVariantIds(orderCtx, [
                        orderLine.productVariantId,
                    ])),
                );
            }
            await this.stockLevelService.lockStockLevelsForVariants(txCtx, trackedVariantIds, {
                includeUntrackedVariants: true,
            });

            for (const { orderLine, quantity } of orderLinesToAllocate) {
                // Stock decisions follow the Order's Channel, not the Channel of whoever triggered
                // the allocation (e.g. an Administrator adding a payment from the default Channel).
                const orderCtx = await this.getOrderContext(txCtx, orderLine.order.id, orderContexts);
                const productVariant = await this.connection.getEntityOrThrow(
                    orderCtx,
                    ProductVariant,
                    orderLine.productVariantId,
                    { includeSoftDeleted: true },
                );
                const allocationLocations = await this.stockLocationService.getAllocationLocations(
                    orderCtx,
                    orderLine,
                    quantity,
                );
                const allocatedForLine = allocationLocations.reduce((sum, l) => sum + l.quantity, 0);
                // Stock can only fall short if none of the StockLevels the Order's Channel can
                // allocate from is untracked. Resolved per StockLevel, so a StockLevel set to TRUE
                // on an otherwise untracked variant still reports its shortfall.
                if (
                    allocatedForLine < quantity &&
                    !(await this.stockLevelService.hasUntrackedStock(orderCtx, productVariant))
                ) {
                    const shortfall: StockShortfall = {
                        productVariantId: orderLine.productVariantId,
                        orderLineId: orderLine.id,
                        requested: quantity,
                        allocated: allocatedForLine,
                    };
                    const group = shortfallsByOrder.get(orderLine.order.id);
                    if (group) {
                        group.shortfalls.push(shortfall);
                    } else {
                        shortfallsByOrder.set(orderLine.order.id, {
                            order: orderLine.order,
                            shortfalls: [shortfall],
                        });
                    }
                }
                for (const allocationLocation of allocationLocations) {
                    // Recorded on the Allocation, so that the Release or Sale which later consumes
                    // it does the opposite of what was done here, even if `trackInventory` has
                    // changed in the meantime. The strategy's own decision is used when it gives
                    // one, so the record matches the cap it applied.
                    const tracked =
                        allocationLocation.tracked ??
                        (await this.stockLevelService.isInventoryTrackedAtLocation(
                            orderCtx,
                            productVariant,
                            allocationLocation.location.id,
                        ));
                    const allocation = new Allocation({
                        productVariant: new ProductVariant({ id: orderLine.productVariantId }),
                        stockLocation: allocationLocation.location,
                        quantity: allocationLocation.quantity,
                        orderLine,
                        tracked,
                    });
                    allocations.push(allocation);

                    if (tracked) {
                        await this.stockLevelService.updateStockAllocatedForLocation(
                            orderCtx,
                            orderLine.productVariantId,
                            allocationLocation.location.id,
                            allocationLocation.quantity,
                        );
                    }
                }
            }
            const savedAllocations = await this.connection.getRepository(txCtx, Allocation).save(allocations);
            if (savedAllocations.length) {
                await this.eventBus.publish(new StockMovementEvent(txCtx, savedAllocations));
            }
            for (const { order, shortfalls } of shortfallsByOrder.values()) {
                // Surface the shortfall in the logs: allocation is capped rather than failed (the
                // payment may already be captured), so without this a paid-but-under-allocated Order
                // looks normal in the admin UI. The StockShortfallEvent lets a plugin react further.
                for (const shortfall of shortfalls) {
                    Logger.warn(
                        `Stock shortfall on Order ${order.code}: ProductVariant ` +
                            `${shortfall.productVariantId} requested ${shortfall.requested}, ` +
                            `allocated ${shortfall.allocated}`,
                        loggerCtx,
                    );
                }
                await this.eventBus.publish(new StockShortfallEvent(txCtx, order, shortfalls));
            }
            return savedAllocations;
        });
    }

    /**
     * @description
     * Creates {@link Sale}s for each OrderLine in the Order. For ProductVariants
     * which are configured to track stock levels, the `ProductVariant.stockAllocated` value is
     * reduced and the `stockOnHand` value is also reduced by the OrderLine quantity, indicating
     * that the stock is no longer allocated, but is actually sold and no longer available.
     */
    async createSalesForOrder(ctx: RequestContext, lines: OrderLineInput[]): Promise<Sale[]> {
        const sales: Sale[] = [];
        const orderLines = await this.connection
            .getRepository(ctx, OrderLine)
            .find({ where: { id: In(lines.map(line => line.orderLineId)) }, relations: { order: true } });
        const orderContexts = new Map<string, RequestContext>();
        const ledgerCache = new Map<string, LineMovements>();
        // Untracked variants are locked too: what these movements change follows the tracked
        // state recorded on earlier movements, which can differ from the current setting.
        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            orderLines.map(line => line.productVariantId),
            { includeUntrackedVariants: true },
        );
        for (const lineRow of lines) {
            const orderLine = orderLines.find(line => idsAreEqual(line.id, lineRow.orderLineId));
            if (!orderLine) {
                continue;
            }
            const orderCtx = await this.getOrderContext(ctx, orderLine.order.id, orderContexts);
            const productVariant = await this.connection.getEntityOrThrow(
                orderCtx,
                ProductVariant,
                orderLine.productVariantId,
                { includeSoftDeleted: true },
            );
            const saleLocations = await this.stockLocationService.getSaleLocations(
                orderCtx,
                orderLine,
                lineRow.quantity,
            );
            for (const saleLocation of saleLocations) {
                const { allocatedTracked } = await this.getTrackedLedger(
                    orderCtx,
                    orderLine.id,
                    productVariant,
                    saleLocation.location.id,
                    ledgerCache,
                );
                // Only units whose Allocation was tracked are deducted, whatever the setting is
                // now: those are the units that were added to stockAllocated.
                const trackedQuantity = Math.min(saleLocation.quantity, allocatedTracked);
                for (const [quantity, tracked] of this.splitByTracked(
                    saleLocation.quantity,
                    trackedQuantity,
                )) {
                    sales.push(
                        new Sale({
                            productVariant,
                            quantity: -quantity,
                            orderLine,
                            stockLocation: saleLocation.location,
                            tracked,
                        }),
                    );
                }
                if (trackedQuantity > 0) {
                    await this.stockLevelService.updateStockAllocatedForLocation(
                        orderCtx,
                        orderLine.productVariantId,
                        saleLocation.location.id,
                        -trackedQuantity,
                    );
                    await this.stockLevelService.updateStockOnHandForLocation(
                        orderCtx,
                        orderLine.productVariantId,
                        saleLocation.location.id,
                        -trackedQuantity,
                    );
                }
            }
        }
        const savedSales = await this.connection.getRepository(ctx, Sale).save(sales);
        if (savedSales.length) {
            await this.eventBus.publish(new StockMovementEvent(ctx, savedSales));
        }
        return savedSales;
    }

    /**
     * @description
     * Creates a {@link Cancellation} for each of the specified OrderItems. For ProductVariants
     * which are configured to track stock levels, the `ProductVariant.stockOnHand` value is
     * increased for each Cancellation, allowing that stock to be sold again.
     */
    async createCancellationsForOrderLines(
        ctx: RequestContext,
        lineInputs: OrderLineInput[],
    ): Promise<Cancellation[]> {
        const orderLines = await this.connection.getRepository(ctx, OrderLine).find({
            where: {
                id: In(lineInputs.map(l => l.orderLineId)),
            },
            relations: { productVariant: true, order: true },
        });
        const orderContexts = new Map<string, RequestContext>();
        const ledgerCache = new Map<string, LineMovements>();

        // Untracked variants are locked too: what these movements change follows the tracked
        // state recorded on earlier movements, which can differ from the current setting.
        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            orderLines.map(line => line.productVariantId),
            { includeUntrackedVariants: true },
        );

        const cancellations: Cancellation[] = [];
        for (const orderLine of orderLines) {
            const lineInput = lineInputs.find(l => idsAreEqual(l.orderLineId, orderLine.id));
            if (!lineInput) {
                continue;
            }
            const orderCtx = await this.getOrderContext(ctx, orderLine.order.id, orderContexts);
            const cancellationLocations = await this.stockLocationService.getCancellationLocations(
                orderCtx,
                orderLine,
                lineInput.quantity,
            );
            for (const cancellationLocation of cancellationLocations) {
                const { soldTracked } = await this.getTrackedLedger(
                    orderCtx,
                    orderLine.id,
                    orderLine.productVariant,
                    cancellationLocation.location.id,
                    ledgerCache,
                );
                // Only units whose Sale deducted stockOnHand are put back.
                const trackedQuantity = Math.min(cancellationLocation.quantity, soldTracked);
                for (const [quantity, tracked] of this.splitByTracked(
                    cancellationLocation.quantity,
                    trackedQuantity,
                )) {
                    cancellations.push(
                        new Cancellation({
                            productVariant: orderLine.productVariant,
                            quantity,
                            orderLine,
                            stockLocation: cancellationLocation.location,
                            tracked,
                        }),
                    );
                }
                if (trackedQuantity > 0) {
                    await this.stockLevelService.updateStockOnHandForLocation(
                        orderCtx,
                        orderLine.productVariantId,
                        cancellationLocation.location.id,
                        trackedQuantity,
                    );
                }
            }
        }
        const savedCancellations = await this.connection.getRepository(ctx, Cancellation).save(cancellations);
        if (savedCancellations.length) {
            await this.eventBus.publish(new StockMovementEvent(ctx, savedCancellations));
        }
        return savedCancellations;
    }

    /**
     * @description
     * Creates a {@link Release} for each of the specified OrderItems. For ProductVariants
     * which are configured to track stock levels, the `ProductVariant.stockAllocated` value is
     * reduced, indicating that this stock is once again available to buy.
     */
    async createReleasesForOrderLines(ctx: RequestContext, lineInputs: OrderLineInput[]): Promise<Release[]> {
        const releases: Release[] = [];
        const orderLines = await this.connection.getRepository(ctx, OrderLine).find({
            where: { id: In(lineInputs.map(l => l.orderLineId)) },
            relations: { productVariant: true, order: true },
        });
        const orderContexts = new Map<string, RequestContext>();
        const ledgerCache = new Map<string, LineMovements>();
        // Untracked variants are locked too: what these movements change follows the tracked
        // state recorded on earlier movements, which can differ from the current setting.
        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            orderLines.map(line => line.productVariantId),
            { includeUntrackedVariants: true },
        );
        for (const orderLine of orderLines) {
            const lineInput = lineInputs.find(l => idsAreEqual(l.orderLineId, orderLine.id));
            if (!lineInput) {
                continue;
            }
            const orderCtx = await this.getOrderContext(ctx, orderLine.order.id, orderContexts);
            const releaseLocations = await this.stockLocationService.getReleaseLocations(
                orderCtx,
                orderLine,
                lineInput.quantity,
            );
            for (const releaseLocation of releaseLocations) {
                const { allocatedTracked } = await this.getTrackedLedger(
                    orderCtx,
                    orderLine.id,
                    orderLine.productVariant,
                    releaseLocation.location.id,
                    ledgerCache,
                );
                // Only units whose Allocation was tracked are released from stockAllocated.
                const trackedQuantity = Math.min(releaseLocation.quantity, allocatedTracked);
                for (const [quantity, tracked] of this.splitByTracked(
                    releaseLocation.quantity,
                    trackedQuantity,
                )) {
                    releases.push(
                        new Release({
                            productVariant: orderLine.productVariant,
                            quantity,
                            orderLine,
                            stockLocation: releaseLocation.location,
                            tracked,
                        }),
                    );
                }
                if (trackedQuantity > 0) {
                    await this.stockLevelService.updateStockAllocatedForLocation(
                        orderCtx,
                        orderLine.productVariantId,
                        releaseLocation.location.id,
                        -trackedQuantity,
                    );
                }
            }
        }
        const savedReleases = await this.connection.getRepository(ctx, Release).save(releases);
        if (savedReleases.length) {
            await this.eventBus.publish(new StockMovementEvent(ctx, savedReleases));
        }
        return savedReleases;
    }

    /**
     * @description
     * Reverses Sales when a Fulfillment is cancelled: the units go back on hand and are allocated
     * to the OrderLine again, so that it can be fulfilled again. For each StockLocation, a
     * {@link Cancellation} and an {@link Allocation} are created with the same `tracked` state as
     * the Sales they reverse. Only units whose Sale deducted stockOnHand change the figures, so
     * the stock figures come out exactly as they were before the Fulfillment, whatever
     * `trackInventory` is now.
     *
     * Before v4.0, the default FulfillmentProcess called `createCancellationsForOrderLines()`
     * then `createAllocationsForOrderLines()`, which re-resolved tracking and re-ran the
     * StockLocationStrategy (capping the re-allocation by available stock).
     *
     * @since 4.0.0
     */
    async reverseSalesForOrderLines(
        ctx: RequestContext,
        lineInputs: OrderLineInput[],
    ): Promise<{ cancellations: Cancellation[]; allocations: Allocation[] }> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const orderLines = await this.connection.getRepository(txCtx, OrderLine).find({
                where: { id: In(lineInputs.map(l => l.orderLineId)) },
                relations: { productVariant: true, order: true },
            });
            await this.stockLevelService.lockStockLevelsForVariants(
                txCtx,
                orderLines.map(line => line.productVariantId),
                { includeUntrackedVariants: true },
            );
            const orderContexts = new Map<string, RequestContext>();
            const ledgerCache = new Map<string, LineMovements>();
            const cancellations: Cancellation[] = [];
            const allocations: Allocation[] = [];
            for (const orderLine of orderLines) {
                const lineInput = lineInputs.find(l => idsAreEqual(l.orderLineId, orderLine.id));
                if (!lineInput) {
                    continue;
                }
                const orderCtx = await this.getOrderContext(txCtx, orderLine.order.id, orderContexts);
                const locations = await this.stockLocationService.getCancellationLocations(
                    orderCtx,
                    orderLine,
                    lineInput.quantity,
                );
                for (const { location, quantity: locationQuantity } of locations) {
                    const { soldTracked } = await this.getTrackedLedger(
                        orderCtx,
                        orderLine.id,
                        orderLine.productVariant,
                        location.id,
                        ledgerCache,
                    );
                    const trackedQuantity = Math.min(locationQuantity, soldTracked);
                    for (const [quantity, tracked] of this.splitByTracked(
                        locationQuantity,
                        trackedQuantity,
                    )) {
                        cancellations.push(
                            new Cancellation({
                                productVariant: orderLine.productVariant,
                                quantity,
                                orderLine,
                                stockLocation: location,
                                tracked,
                            }),
                        );
                        allocations.push(
                            new Allocation({
                                productVariant: new ProductVariant({ id: orderLine.productVariantId }),
                                quantity,
                                orderLine,
                                stockLocation: location,
                                tracked,
                            }),
                        );
                    }
                    if (trackedQuantity > 0) {
                        await this.stockLevelService.updateStockOnHandForLocation(
                            orderCtx,
                            orderLine.productVariantId,
                            location.id,
                            trackedQuantity,
                        );
                        await this.stockLevelService.updateStockAllocatedForLocation(
                            orderCtx,
                            orderLine.productVariantId,
                            location.id,
                            trackedQuantity,
                        );
                    }
                }
            }
            const savedCancellations = await this.connection
                .getRepository(txCtx, Cancellation)
                .save(cancellations);
            const savedAllocations = await this.connection.getRepository(txCtx, Allocation).save(allocations);
            if (savedCancellations.length) {
                await this.eventBus.publish(new StockMovementEvent(txCtx, savedCancellations));
            }
            if (savedAllocations.length) {
                await this.eventBus.publish(new StockMovementEvent(txCtx, savedAllocations));
            }
            return { cancellations: savedCancellations, allocations: savedAllocations };
        });
    }

    private async getOrderContext(
        ctx: RequestContext,
        orderId: ID,
        cache: Map<string, RequestContext>,
    ): Promise<RequestContext> {
        const key = String(orderId);
        let orderCtx = cache.get(key);
        if (!orderCtx) {
            orderCtx = await getOrderChannelContext(ctx, this.connection, this.channelService, orderId);
            cache.set(key, orderCtx);
        }
        return orderCtx;
    }

    /**
     * The tracked quantities of an OrderLine at one StockLocation, read from its stock movements:
     * - `allocatedTracked`: units added to stockAllocated and not yet released or sold
     * - `soldTracked`: units deducted from stockOnHand by a Sale and not yet cancelled
     *
     * The line's movements are read once per call of the public method (`cache`), not once per
     * location. Movements recorded before v4.0 and not backfilled by the migration have
     * `tracked: null`; they count as tracked if inventory is tracked at the location now, which
     * is what the pre-v4 code assumed.
     */
    private async getTrackedLedger(
        ctx: RequestContext,
        orderLineId: ID,
        productVariant: Pick<ProductVariant, 'id' | 'trackInventory'>,
        stockLocationId: ID,
        cache: Map<string, LineMovements>,
    ): Promise<{ allocatedTracked: number; soldTracked: number }> {
        const key = String(orderLineId);
        let movements = cache.get(key);
        if (!movements) {
            const where: FindOptionsWhere<Allocation> = { orderLine: { id: orderLineId } };
            // Sequential rather than Promise.all: one connection per transaction.
            movements = {
                allocations: await this.connection.getRepository(ctx, Allocation).find({ where }),
                releases: await this.connection
                    .getRepository(ctx, Release)
                    .find({ where: where as FindOptionsWhere<Release> }),
                sales: await this.connection
                    .getRepository(ctx, Sale)
                    .find({ where: where as FindOptionsWhere<Sale> }),
                cancellations: await this.connection
                    .getRepository(ctx, Cancellation)
                    .find({ where: where as FindOptionsWhere<Cancellation> }),
            };
            cache.set(key, movements);
        }
        const atLocation = (rows: StockMovement[]) =>
            rows.filter(row => idsAreEqual(row.stockLocationId, stockLocationId));
        const { allocations, releases, sales, cancellations } = {
            allocations: atLocation(movements.allocations),
            releases: atLocation(movements.releases),
            sales: atLocation(movements.sales),
            cancellations: atLocation(movements.cancellations),
        };
        const hasLegacyRows = [...allocations, ...releases, ...sales, ...cancellations].some(
            row => row.tracked == null,
        );
        const legacyTracked = hasLegacyRows
            ? await this.stockLevelService.isInventoryTrackedAtLocation(ctx, productVariant, stockLocationId)
            : false;
        const trackedSum = (rows: StockMovement[]) =>
            rows.reduce(
                (sum, row) => ((row.tracked ?? legacyTracked) ? sum + Math.abs(row.quantity) : sum),
                0,
            );
        const allocatedTracked = trackedSum(allocations);
        return {
            allocatedTracked: Math.max(0, allocatedTracked - trackedSum(releases) - trackedSum(sales)),
            // Never more than was allocated here: Sales recorded before v4.0 on a line split
            // across locations carry the whole line quantity at each location.
            soldTracked: Math.max(
                0,
                Math.min(trackedSum(sales), allocatedTracked) - trackedSum(cancellations),
            ),
        };
    }

    /**
     * Splits a movement quantity into its tracked and untracked parts, omitting an empty part.
     */
    private splitByTracked(total: number, trackedQuantity: number): Array<[number, boolean]> {
        const parts: Array<[number, boolean]> = [];
        if (trackedQuantity > 0) {
            parts.push([trackedQuantity, true]);
        }
        if (total - trackedQuantity > 0) {
            parts.push([total - trackedQuantity, false]);
        }
        return parts;
    }
}
