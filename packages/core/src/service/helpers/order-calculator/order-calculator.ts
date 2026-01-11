import { Injectable } from '@nestjs/common';
import { filterAsync } from '@vendure/common/lib/filter-async';
import { AdjustmentType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { CacheKey } from '../../../common/constants';
import { InternalServerError } from '../../../common/error/errors';
import { Instrument } from '../../../common/instrument-decorator';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection';
import { OrderLine, TaxRate } from '../../../entity';
import { Order } from '../../../entity/order/order.entity';
import { Promotion } from '../../../entity/promotion/promotion.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { ShippingMethodService } from '../../services/shipping-method.service';
import { TaxRateService } from '../../services/tax-rate.service';
import { ZoneService } from '../../services/zone.service';
import { ShippingCalculator } from '../shipping-calculator/shipping-calculator';

import { prorate } from './prorate';

/**
 * @description
 * This helper is used when making changes to an Order, to apply all applicable price adjustments to that Order,
 * including:
 *
 * - Promotions
 * - Taxes
 * - Shipping
 *
 * @docsCategory service-helpers
 */
@Injectable()
@Instrument()
export class OrderCalculator {
    constructor(
        private configService: ConfigService,
        private zoneService: ZoneService,
        private taxRateService: TaxRateService,
        private shippingMethodService: ShippingMethodService,
        private shippingCalculator: ShippingCalculator,
        private requestContextCache: RequestContextCacheService,
        private connection: TransactionalConnection,
    ) {}

    /**
     * @description
     * Applies taxes and promotions to an Order. Mutates the order object.
     * Returns an array of any OrderItems which had new adjustments
     * applied, either tax or promotions.
     */
    async applyPriceAdjustments(
        ctx: RequestContext,
        order: Order,
        promotions: Promotion[],
        updatedOrderLines: OrderLine[] = [],
        options?: { recalculateShipping?: boolean },
    ): Promise<Order> {
        const { taxZoneStrategy } = this.configService.taxOptions;
        // We reset the promotions array as all promotions
        // must be revalidated on any changes to an Order.
        order.promotions = [];
        const zones = await this.zoneService.getAllWithMembers(ctx);
        const activeTaxZone = await this.requestContextCache.get(ctx, CacheKey.ActiveTaxZone, () =>
            taxZoneStrategy.determineTaxZone(ctx, zones, ctx.channel, order),
        );

        let taxZoneChanged = false;
        if (!activeTaxZone) {
            throw new InternalServerError('error.no-active-tax-zone');
        }
        if (!order.taxZoneId || !idsAreEqual(order.taxZoneId, activeTaxZone.id)) {
            order.taxZoneId = activeTaxZone.id;
            taxZoneChanged = true;
        }
        for (const updatedOrderLine of updatedOrderLines) {
            await this.applyTaxesToOrderLine(
                ctx,
                order,
                updatedOrderLine,
                this.createTaxRateGetter(ctx, activeTaxZone),
            );
        }
        this.calculateOrderTotals(order);
        if (order.lines.length) {
            if (taxZoneChanged) {
                // First apply taxes to the non-discounted prices
                await this.applyTaxes(ctx, order, activeTaxZone);
            }

            // Then test and apply promotions
            const totalBeforePromotions = order.subTotal;
            await this.applyPromotions(ctx, order, promotions);

            if (order.subTotal !== totalBeforePromotions) {
                // Finally, re-calculate taxes because the promotions may have
                // altered the unit prices, which in turn will alter the tax payable.
                await this.applyTaxes(ctx, order, activeTaxZone);
            }
        }
        if (options?.recalculateShipping !== false) {
            await this.applyShipping(ctx, order);
            await this.applyShippingPromotions(ctx, order, promotions);
        }
        this.calculateOrderTotals(order);
        return order;
    }

    /**
     * @description
     * Applies the correct TaxRate to each OrderLine in the order.
     */
    private async applyTaxes(ctx: RequestContext, order: Order, activeZone: Zone) {
        const getTaxRate = this.createTaxRateGetter(ctx, activeZone);
        for (const line of order.lines) {
            await this.applyTaxesToOrderLine(ctx, order, line, getTaxRate);
        }
        this.calculateOrderTotals(order);
    }

    /**
     * @description
     * Applies the correct TaxRate to an OrderLine
     */
    private async applyTaxesToOrderLine(
        ctx: RequestContext,
        order: Order,
        line: OrderLine,
        getTaxRate: (taxCategoryId: ID) => Promise<TaxRate>,
    ) {
        const applicableTaxRate = await getTaxRate(line.taxCategoryId);
        const { taxLineCalculationStrategy } = this.configService.taxOptions;
        line.taxLines = await taxLineCalculationStrategy.calculate({
            ctx,
            applicableTaxRate,
            order,
            orderLine: line,
        });
        await this.connection.getRepository(ctx, OrderLine).save(line, { reload: false });
    }

    /**
     * @description
     * Returns a memoized function for performing an efficient
     * lookup of the correct TaxRate for a given TaxCategory.
     */
    private createTaxRateGetter(
        ctx: RequestContext,
        activeZone: Zone,
    ): (taxCategoryId: ID) => Promise<TaxRate> {
        const taxRateCache = new Map<ID, TaxRate>();

        return async (taxCategoryId: ID): Promise<TaxRate> => {
            const cached = taxRateCache.get(taxCategoryId);
            if (cached) {
                return cached;
            }
            const rate = await this.taxRateService.getApplicableTaxRate(ctx, activeZone, taxCategoryId);
            taxRateCache.set(taxCategoryId, rate);
            return rate;
        };
    }

    /**
     * @description
     * Applies any eligible promotions to each OrderLine in the order.
     */
    private async applyPromotions(ctx: RequestContext, order: Order, promotions: Promotion[]): Promise<void> {
        await this.applyOrderItemPromotions(ctx, order, promotions);
        await this.applyOrderPromotions(ctx, order, promotions);
        return;
    }

    /**
     * @description
     * Applies promotions to OrderItems. This is a quite complex function, due to the inherent complexity
     * of applying the promotions, and also due to added complexity in the name of performance
     * optimization. Therefore, it is heavily annotated so that the purpose of each step is clear.
     * Additionally, this is used in both promotionItemAction and promotionLineAction,
     * as it is difficult to separate action types at this stage.
     */
    private async applyOrderItemPromotions(
        ctx: RequestContext,
        order: Order,
        promotions: Promotion[],
    ): Promise<void> {
        for (const line of order.lines) {
            // Must be re-calculated for each line, since the previous lines may have triggered promotions
            // which affected the order price.
            line.clearAdjustments();

            for (const promotion of promotions) {
                // We need to test the promotion *again*, even though we've tested them for the line.
                // This is because the previous Promotions may have adjusted the Order in such a way
                // as to render later promotions no longer applicable.
                const applicableOrState = await promotion.test(ctx, order);
                if (applicableOrState) {
                    const state = typeof applicableOrState === 'object' ? applicableOrState : undefined;
                    const adjustment = await promotion.apply(ctx, { orderLine: line }, state);
                    if (adjustment) {
                        line.addAdjustment(adjustment);
                        this.calculateOrderTotals(order);
                    }
                    this.addPromotion(order, promotion);
                }
            }
            this.calculateOrderTotals(order);
        }
        return;
    }

    private async applyOrderPromotions(
        ctx: RequestContext,
        order: Order,
        promotions: Promotion[],
    ): Promise<void> {
        const orderHasDistributedPromotions = !!order.discounts.find(
            adjustment => adjustment.type === AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
        );
        if (orderHasDistributedPromotions) {
            // If the Order currently has any Order-level discounts applied, we need to
            // mark all OrderItems in the Order as "updated", since one or more of those
            // Order-level discounts may become invalid, which will require _all_ OrderItems
            // to be saved.
            order.lines.forEach(line => {
                line.clearAdjustments(AdjustmentType.DISTRIBUTED_ORDER_PROMOTION);
            });
        }

        this.calculateOrderTotals(order);
        const applicableOrderPromotions = await filterAsync(promotions, p =>
            p.test(ctx, order).then(Boolean),
        );
        if (applicableOrderPromotions.length) {
            for (const promotion of applicableOrderPromotions) {
                // re-test the promotion on each iteration, since the order total
                // may be modified by a previously-applied promotion
                const applicableOrState = await promotion.test(ctx, order);
                if (applicableOrState) {
                    const state = typeof applicableOrState === 'object' ? applicableOrState : undefined;
                    const adjustment = await promotion.apply(ctx, { order }, state);
                    if (adjustment && adjustment.amount !== 0) {
                        const amount = adjustment.amount;
                        const weights = order.lines.map(l =>
                            l.quantity !== 0 ? l.proratedLinePriceWithTax : 0,
                        );
                        const distribution = prorate(weights, amount);
                        order.lines.forEach((line, i) => {
                            const shareOfAmount = distribution[i];
                            const itemWeights = Array.from({
                                length: line.quantity,
                            }).map(() => line.unitPrice);
                            const itemDistribution = prorate(itemWeights, shareOfAmount);
                            line.addAdjustment({
                                amount: shareOfAmount,
                                adjustmentSource: adjustment.adjustmentSource,
                                description: adjustment.description,
                                type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
                                data: { itemDistribution },
                            });
                        });
                        this.calculateOrderTotals(order);
                    }
                    this.addPromotion(order, promotion);
                }
            }
            this.calculateOrderTotals(order);
        }
        return;
    }

    private async applyShippingPromotions(ctx: RequestContext, order: Order, promotions: Promotion[]) {
        const applicableOrderPromotions = await filterAsync(promotions, p =>
            p.test(ctx, order).then(Boolean),
        );
        if (applicableOrderPromotions.length) {
            order.shippingLines.forEach(line => line.clearAdjustments());
            for (const promotion of applicableOrderPromotions) {
                // re-test the promotion on each iteration, since the order total
                // may be modified by a previously-applied promotion
                const applicableOrState = await promotion.test(ctx, order);
                if (applicableOrState) {
                    const state = typeof applicableOrState === 'object' ? applicableOrState : undefined;
                    for (const shippingLine of order.shippingLines) {
                        const adjustment = await promotion.apply(ctx, { shippingLine, order }, state);
                        if (adjustment && adjustment.amount !== 0) {
                            shippingLine.addAdjustment(adjustment);
                        }
                    }
                    this.addPromotion(order, promotion);
                }
            }
        } else {
            // If there is no applicable promotion for shipping,
            // we should remove already assigned adjustment from shipping lines.
            for (const shippingLine of order.shippingLines) {
                shippingLine.clearAdjustments();
            }
        }
    }

    private async applyShipping(ctx: RequestContext, order: Order) {
        // First we need to remove any ShippingLines which are no longer applicable
        // to the Order, i.e. there is no OrderLine which is assigned to the ShippingLine's
        // ShippingMethod.
        const orderLineShippingLineIds = order.lines.map(line => line.shippingLineId);
        order.shippingLines = order.shippingLines.filter(shippingLine =>
            orderLineShippingLineIds.includes(shippingLine.id),
        );
        for (const shippingLine of order.shippingLines) {
            const currentShippingMethod =
                shippingLine?.shippingMethodId &&
                (await this.shippingMethodService.findOne(ctx, shippingLine.shippingMethodId));
            if (!currentShippingMethod) {
                return;
            }
            const currentMethodStillEligible = await currentShippingMethod.test(ctx, order);
            if (currentMethodStillEligible) {
                const result = await currentShippingMethod.apply(ctx, order);
                if (result) {
                    shippingLine.listPrice = result.price;
                    shippingLine.listPriceIncludesTax = result.priceIncludesTax;
                    shippingLine.taxLines = [
                        {
                            description: 'shipping tax',
                            taxRate: result.taxRate,
                        },
                    ];
                }
                continue;
            }
            const results = await this.shippingCalculator.getEligibleShippingMethods(ctx, order, [
                currentShippingMethod.id,
            ]);
            if (results && results.length) {
                const cheapest = results[0];
                shippingLine.listPrice = cheapest.result.price;
                shippingLine.listPriceIncludesTax = cheapest.result.priceIncludesTax;
                shippingLine.shippingMethod = cheapest.method;
                shippingLine.shippingMethodId = cheapest.method.id;
                shippingLine.taxLines = [
                    {
                        description: 'shipping tax',
                        taxRate: cheapest.result.taxRate,
                    },
                ];
            } else {
                order.shippingLines = order.shippingLines.filter(sl => sl !== shippingLine);
            }
        }
    }

    /**
     * @description
     * Sets the totals properties on an Order by summing each OrderLine, and taking
     * into account any Surcharges and ShippingLines. Does not save the Order, so
     * the entity must be persisted to the DB after calling this method.
     *
     * Note that this method does *not* evaluate any taxes or promotions. It assumes
     * that has already been done and is solely responsible for summing the
     * totals.
     */
    public calculateOrderTotals(order: Order) {
        let totalPrice = 0;
        let totalPriceWithTax = 0;

        for (const line of order.lines) {
            totalPrice += line.proratedLinePrice;
            totalPriceWithTax += line.proratedLinePriceWithTax;
        }
        for (const surcharge of order.surcharges) {
            totalPrice += surcharge.price;
            totalPriceWithTax += surcharge.priceWithTax;
        }

        order.subTotal = totalPrice;
        order.subTotalWithTax = totalPriceWithTax;

        let shippingPrice = 0;
        let shippingPriceWithTax = 0;
        for (const shippingLine of order.shippingLines) {
            shippingPrice += shippingLine.discountedPrice;
            shippingPriceWithTax += shippingLine.discountedPriceWithTax;
        }

        order.shipping = shippingPrice;
        order.shippingWithTax = shippingPriceWithTax;
    }

    private addPromotion(order: Order, promotion: Promotion) {
        if (order.promotions && !order.promotions.find(p => idsAreEqual(p.id, promotion.id))) {
            order.promotions.push(promotion);
        }
    }
}
