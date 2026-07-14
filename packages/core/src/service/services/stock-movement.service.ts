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
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';

import { GlobalSettingsService } from './global-settings.service';
import { StockLevelService } from './stock-level.service';
import { StockLocationService } from './stock-location.service';

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
     */
    async adjustProductVariantStock(
        ctx: RequestContext,
        productVariantId: ID,
        stockOnHandNumberOrInput: number | StockLevelInput[],
    ): Promise<StockAdjustment[]> {
        let stockOnHandInputs: StockLevelInput[];
        if (typeof stockOnHandNumberOrInput === 'number') {
            const defaultStockLocation = await this.stockLocationService.defaultStockLocation(ctx);
            stockOnHandInputs = [
                { stockLocationId: defaultStockLocation.id, stockOnHand: stockOnHandNumberOrInput },
            ];
        } else {
            stockOnHandInputs = stockOnHandNumberOrInput;
        }
        const adjustments: StockAdjustment[] = [];
        for (const input of stockOnHandInputs) {
            const stockLevel = await this.stockLevelService.getStockLevel(
                ctx,
                productVariantId,
                input.stockLocationId,
            );
            const oldStockLevel = stockLevel.stockOnHand;
            const newStockLevel = input.stockOnHand;
            if (oldStockLevel === newStockLevel) {
                continue;
            }
            const delta = newStockLevel - oldStockLevel;
            const adjustment = await this.connection.getRepository(ctx, StockAdjustment).save(
                new StockAdjustment({
                    quantity: delta,
                    stockLocation: { id: input.stockLocationId },
                    productVariant: { id: productVariantId },
                }),
            );
            await this.stockLevelService.updateStockOnHandForLocation(
                ctx,
                productVariantId,
                input.stockLocationId,
                delta,
            );
            await this.eventBus.publish(new StockMovementEvent(ctx, [adjustment]));
            adjustments.push(adjustment);
        }

        return adjustments;
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
        const allocations: Allocation[] = [];
        const globalTrackInventory = (await this.globalSettingsService.getSettings(ctx)).trackInventory;
        for (const { orderLineId, quantity } of lines) {
            const orderLine = await this.connection.getEntityOrThrow(ctx, OrderLine, orderLineId);
            const productVariant = await this.connection.getEntityOrThrow(
                ctx,
                ProductVariant,
                orderLine.productVariantId,
                { includeSoftDeleted: true },
            );
            const allocationLocations = await this.stockLocationService.getAllocationLocations(
                ctx,
                orderLine,
                quantity,
            );
            for (const allocationLocation of allocationLocations) {
                const allocation = new Allocation({
                    productVariant: new ProductVariant({ id: orderLine.productVariantId }),
                    stockLocation: allocationLocation.location,
                    quantity: allocationLocation.quantity,
                    orderLine,
                });
                allocations.push(allocation);

                if (this.trackInventoryForVariant(productVariant, globalTrackInventory)) {
                    await this.stockLevelService.updateStockAllocatedForLocation(
                        ctx,
                        orderLine.productVariantId,
                        allocationLocation.location.id,
                        allocationLocation.quantity,
                    );
                }
            }
        }
        const savedAllocations = await this.connection.getRepository(ctx, Allocation).save(allocations);
        if (savedAllocations.length) {
            await this.eventBus.publish(new StockMovementEvent(ctx, savedAllocations));
        }
        return savedAllocations;
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
            relations: ['productVariant'],
        });

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
            relations: ['productVariant'],
        });
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
