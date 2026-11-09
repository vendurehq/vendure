import { Injectable } from '@nestjs/common';
import {
    GlobalFlag,
    OrderLineInput,
    StockLevelInput,
    StockMovementListOptions,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { In } from 'typeorm';

import { RequestContext } from '../../api/common/request-context';
import { Instrument } from '../../common/instrument-decorator';
import { idsAreEqual } from '../../common/utils';
import { Logger } from '../../config/logger/vendure-logger';
import { ShippingCalculator } from '../../config/shipping-method/shipping-calculator';
import { ShippingEligibilityChecker } from '../../config/shipping-method/shipping-eligibility-checker';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { ShippingMethod } from '../../entity/shipping-method/shipping-method.entity';
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

import { GlobalSettingsService } from './global-settings.service';
import { StockLevelService } from './stock-level.service';
import { StockLocationService } from './stock-location.service';

const loggerCtx = 'StockMovementService';

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
        private globalSettingsService: GlobalSettingsService,
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
            const globalTrackInventory = (await this.globalSettingsService.getSettings(txCtx)).trackInventory;

            const orderLinesToAllocate = await Promise.all(
                lines.map(async ({ orderLineId, quantity }) => ({
                    orderLine: await this.connection.getEntityOrThrow(txCtx, OrderLine, orderLineId, {
                        relations: ['order'],
                    }),
                    quantity,
                })),
            );
            await this.stockLevelService.lockStockLevelsForVariants(
                txCtx,
                orderLinesToAllocate.map(({ orderLine }) => orderLine.productVariantId),
            );

            for (const { orderLine, quantity } of orderLinesToAllocate) {
                const productVariant = await this.connection.getEntityOrThrow(
                    txCtx,
                    ProductVariant,
                    orderLine.productVariantId,
                    { includeSoftDeleted: true },
                );
                const allocationLocations = await this.stockLocationService.getAllocationLocations(
                    txCtx,
                    orderLine,
                    quantity,
                );
                const trackInventory = this.trackInventoryForVariant(productVariant, globalTrackInventory);
                const allocatedForLine = allocationLocations.reduce((sum, l) => sum + l.quantity, 0);
                // A variant which does not track inventory has no stock to fall short of, even
                // when it has no StockLevel in the Channel's locations and so gets no allocation.
                if (trackInventory && allocatedForLine < quantity) {
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
                    const allocation = new Allocation({
                        productVariant: new ProductVariant({ id: orderLine.productVariantId }),
                        stockLocation: allocationLocation.location,
                        quantity: allocationLocation.quantity,
                        orderLine,
                    });
                    allocations.push(allocation);

                    if (trackInventory) {
                        await this.stockLevelService.updateStockAllocatedForLocation(
                            txCtx,
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
        const globalTrackInventory = (await this.globalSettingsService.getSettings(ctx)).trackInventory;
        const orderLines = await this.connection
            .getRepository(ctx, OrderLine)
            .find({ where: { id: In(lines.map(line => line.orderLineId)) } });
        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            orderLines.map(line => line.productVariantId),
        );
        for (const lineRow of lines) {
            const orderLine = orderLines.find(line => idsAreEqual(line.id, lineRow.orderLineId));
            if (!orderLine) {
                continue;
            }
            const productVariant = await this.connection.getEntityOrThrow(
                ctx,
                ProductVariant,
                orderLine.productVariantId,
                { includeSoftDeleted: true },
            );
            const saleLocations = await this.stockLocationService.getSaleLocations(
                ctx,
                orderLine,
                lineRow.quantity,
            );
            for (const saleLocation of saleLocations) {
                const sale = new Sale({
                    productVariant,
                    quantity: lineRow.quantity * -1,
                    orderLine,
                    stockLocation: saleLocation.location,
                });
                sales.push(sale);

                if (this.trackInventoryForVariant(productVariant, globalTrackInventory)) {
                    await this.stockLevelService.updateStockAllocatedForLocation(
                        ctx,
                        orderLine.productVariantId,
                        saleLocation.location.id,
                        -saleLocation.quantity,
                    );
                    await this.stockLevelService.updateStockOnHandForLocation(
                        ctx,
                        orderLine.productVariantId,
                        saleLocation.location.id,
                        -saleLocation.quantity,
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
            relations: { productVariant: true },
        });

        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            orderLines.map(line => line.productVariantId),
        );

        const cancellations: Cancellation[] = [];
        const globalTrackInventory = (await this.globalSettingsService.getSettings(ctx)).trackInventory;
        for (const orderLine of orderLines) {
            const lineInput = lineInputs.find(l => idsAreEqual(l.orderLineId, orderLine.id));
            if (!lineInput) {
                continue;
            }
            const cancellationLocations = await this.stockLocationService.getCancellationLocations(
                ctx,
                orderLine,
                lineInput.quantity,
            );
            for (const cancellationLocation of cancellationLocations) {
                const cancellation = new Cancellation({
                    productVariant: orderLine.productVariant,
                    quantity: lineInput.quantity,
                    orderLine,
                    stockLocation: cancellationLocation.location,
                });
                cancellations.push(cancellation);

                if (this.trackInventoryForVariant(orderLine.productVariant, globalTrackInventory)) {
                    await this.stockLevelService.updateStockOnHandForLocation(
                        ctx,
                        orderLine.productVariantId,
                        cancellationLocation.location.id,
                        cancellationLocation.quantity,
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
            relations: { productVariant: true },
        });
        await this.stockLevelService.lockStockLevelsForVariants(
            ctx,
            orderLines.map(line => line.productVariantId),
        );
        const globalTrackInventory = (await this.globalSettingsService.getSettings(ctx)).trackInventory;
        const variantsMap = new Map<ID, ProductVariant>();
        for (const orderLine of orderLines) {
            const lineInput = lineInputs.find(l => idsAreEqual(l.orderLineId, orderLine.id));
            if (!lineInput) {
                continue;
            }
            const releaseLocations = await this.stockLocationService.getReleaseLocations(
                ctx,
                orderLine,
                lineInput.quantity,
            );
            for (const releaseLocation of releaseLocations) {
                const release = new Release({
                    productVariant: orderLine.productVariant,
                    quantity: lineInput.quantity,
                    orderLine,
                    stockLocation: releaseLocation.location,
                });
                releases.push(release);
                if (this.trackInventoryForVariant(orderLine.productVariant, globalTrackInventory)) {
                    await this.stockLevelService.updateStockAllocatedForLocation(
                        ctx,
                        orderLine.productVariantId,
                        releaseLocation.location.id,
                        -releaseLocation.quantity,
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

    private trackInventoryForVariant(variant: ProductVariant, globalTrackInventory: boolean): boolean {
        return (
            variant.trackInventory === GlobalFlag.TRUE ||
            (variant.trackInventory === GlobalFlag.INHERIT && globalTrackInventory)
        );
    }
}
