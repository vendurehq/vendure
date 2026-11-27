import { Injectable } from '@nestjs/common';
import { filterAsync } from '@vendure/common/lib/filter-async';
import { AdjustmentType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { CacheKey } from '../../../common/constants';
import { InternalServerError } from '../../../common/error/errors';
import { Instrument } from '../../../common/instrument-decorator';
import { roundMoney } from '../../../common/round-money';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { ShippingCalculationResult } from '../../../config/shipping-method/shipping-calculator';
import { OrderLine, TaxRate } from '../../../entity';
import { Order } from '../../../entity/order/order.entity';
import { Promotion } from '../../../entity/promotion/promotion.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { ShippingMethodService } from '../../services/shipping-method.service';
import { TaxRateService } from '../../services/tax-rate.service';
import { ZoneService } from '../../services/zone.service';
import {
    findShippingOption,
    setShippingLineOption,
    ShippingCalculator,
} from '../shipping-calculator/shipping-calculator';
import { resolveTaxCountryCode } from '../utils/resolve-tax-country-code';

import { prorate } from './prorate';

/**
 * @description
 * Options passed to {@link OrderService.applyPriceAdjustments} and {@link OrderCalculator.applyPriceAdjustments}.
 *
 * @docsCategory orders
 * @docsPage OrderRecalculationStrategy
 * @since 3.8.0
 */
export interface ApplyPriceAdjustmentsOptions {
    /**
     * @description
     * Whether the shipping method & rate should be re-evaluated — which may swap the Order's
     * shipping method to a different eligible one. Defaults to `true`.
     */
    recalculateShipping?: boolean;
    /**
     * @description
     * When `recalculateShipping` is `false` (the chosen shipping method & rate are left
     * untouched), this controls whether shipping *promotions* are still re-tested and their
     * adjustments cleared/re-applied. Defaults to the value of `recalculateShipping`, so
     * callers that freeze shipping entirely (e.g. order modification) are unaffected, while
     * read-time recalculation can drop a now-inactive shipping promotion's discount without
     * re-selecting the method.
     */
    recalculateShippingPromotions?: boolean;
    /**
     * @description
     * When `true`, the Promotions already applied to the Order are frozen: their conditions are
     * not re-tested, the existing Adjustments on the OrderLines and ShippingLines are left in
     * place, and `Order.promotions` is not re-built. Only taxes, prices and (unless
     * `recalculateShipping` is `false`) the shipping rate are re-calculated.
     *
     * This is what `modifyOrder` uses to keep the discounts an Order was paid with, see
     * {@link PromotionFreezeStrategy}. The caller is responsible for the Order's `promotions`
     * relation being loaded, since it is kept rather than re-built.
     *
     * The OrderLines keep their discount amounts, so units added to an existing OrderLine get no
     * discount. The shipping discounts are capped at the new shipping price, so a cheaper rate
     * cannot make shipping negative.
     *
     * @default false
     * @since 4.0.0
     */
    freezePromotions?: boolean;
}

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
        options?: ApplyPriceAdjustmentsOptions,
    ): Promise<Order> {
        const freezePromotions = options?.freezePromotions === true;
        if (!freezePromotions) {
            // We reset the promotions array as all promotions
            // must be revalidated on any changes to an Order.
            order.promotions = [];
        }
        const { zone: activeTaxZone, countryCode } = await this.determineTaxTarget(ctx, order);
        const taxTargetChanged = this.taxTargetChanged(order, activeTaxZone, countryCode);
        if (order.taxCountryCode == null && !taxTargetChanged) {
            // The Order has not been calculated since taxCountryCode was added: record the country
            // and keep the taxes it was placed with.
            order.taxCountryCode = countryCode ?? '';
        }
        if (taxTargetChanged) {
            order.taxZoneId = activeTaxZone.id;
            order.taxCountryCode = countryCode ?? '';
        }
        for (const updatedOrderLine of updatedOrderLines) {
            await this.applyTaxesToOrderLine(
                ctx,
                order,
                updatedOrderLine,
                this.createTaxRateGetter(ctx, activeTaxZone, countryCode),
            );
        }
        this.calculateOrderTotals(order);
        if (order.lines.length) {
            if (taxTargetChanged) {
                // First apply taxes to the non-discounted prices
                await this.applyTaxes(ctx, order, activeTaxZone, countryCode);
            }

            if (!freezePromotions) {
                // Then test and apply promotions
                const totalBeforePromotions = order.subTotal;
                await this.applyPromotions(ctx, order, promotions);

                if (order.subTotal !== totalBeforePromotions) {
                    // Finally, re-calculate taxes because the promotions may have
                    // altered the unit prices, which in turn will alter the tax payable.
                    await this.applyTaxes(ctx, order, activeTaxZone, countryCode);
                }
            }
        }
        const recalculateShipping = options?.recalculateShipping !== false;
        // Shipping promotions default to following `recalculateShipping`, but can be re-tested
        // independently: read-time recalculation freezes the chosen method/rate yet must still
        // clear a now-inactive shipping promotion's adjustment (clearAdjustments() only runs
        // inside applyShippingPromotions).
        const recalculateShippingPromotions = options?.recalculateShippingPromotions ?? recalculateShipping;
        if (recalculateShipping) {
            await this.applyShipping(ctx, order);
        }
        if (freezePromotions) {
            this.capShippingDiscounts(order);
        } else if (recalculateShippingPromotions) {
            await this.applyShippingPromotions(ctx, order, promotions);
        }
        this.calculateOrderTotals(order);
        this.removeIneffectivePromotions(order);
        return order;
    }

    /**
     * @description
     * Returns the active tax Zone and the tax country of the Order, from the configured
     * {@link TaxZoneStrategy}. The country is resolved on every call, so that it always reflects
     * the current state of the Order.
     *
     * @internal
     */
    async determineTaxTarget(
        ctx: RequestContext,
        order: Order,
    ): Promise<{ zone: Zone; countryCode: string | undefined }> {
        const { taxZoneStrategy } = this.configService.taxOptions;
        const zones = await this.zoneService.getAllWithMembers(ctx);
        const zone = await this.requestContextCache.get(
            ctx,
            CacheKey.ActiveTaxZone(ctx.channelId, order.id),
            () => taxZoneStrategy.determineTaxZone(ctx, zones, ctx.channel, order),
        );
        if (!zone) {
            throw new InternalServerError('error.no-active-tax-zone');
        }
        const countryCode = await resolveTaxCountryCode(taxZoneStrategy, ctx, ctx.channel, zone, order);
        return { zone, countryCode };
    }

    /**
     * @description
     * Whether the tax Zone or the tax country differs from the one the Order was last calculated
     * with. An Order whose `taxCountryCode` is still `null` was calculated before the field existed,
     * so only its Zone is compared.
     */
    private taxTargetChanged(order: Order, zone: Zone, countryCode: string | undefined): boolean {
        if (!order.taxZoneId || !idsAreEqual(order.taxZoneId, zone.id)) {
            return true;
        }
        return order.taxCountryCode != null && order.taxCountryCode !== (countryCode ?? '');
    }

    /**
     * @description
     * Whether the tax Zone or the tax country of an Order which has been calculated before has
     * changed since then, so that every OrderLine must be priced again. An Order which has not been
     * calculated yet, such as a new seller Order, keeps the prices of its lines.
     *
     * @internal
     */
    async taxTargetChangedSinceLastCalculation(ctx: RequestContext, order: Order): Promise<boolean> {
        if (order.taxZoneId == null) {
            return false;
        }
        const { zone, countryCode } = await this.determineTaxTarget(ctx, order);
        return this.taxTargetChanged(order, zone, countryCode);
    }

    /**
     * @description
     * Converts the `initialListPrice` of a line to the form of its new price, when a change of the
     * tax Zone or country turns a tax-inclusive price into a net price, or back. The net price is
     * taken out at the rate that the Channel's prices include, as
     * {@link DefaultProductVariantPriceCalculationStrategy} does. A gross price which nets out to
     * the recorded net price is unchanged, so rounding does not count as a price change. When the
     * merchant has changed the price, converting a net price back to gross can differ from the
     * gross price the line was added at by one unit of rounding.
     *
     * A custom {@link ProductVariantPriceCalculationStrategy} that takes the net out at another
     * rate makes the converted price differ from the new one, so the
     * {@link ChangedPriceHandlingStrategy} is called for the line as for a price change.
     *
     * @internal
     */
    async convertInitialListPrice(
        ctx: RequestContext,
        line: OrderLine,
        newPrice: { price: number; priceIncludesTax: boolean },
    ): Promise<void> {
        const initialListPrice = line.initialListPrice;
        if (initialListPrice == null || line.listPriceIncludesTax === newPrice.priceIncludesTax) {
            return;
        }
        const includedRate = await this.taxRateService.findIncludedTaxRate(
            ctx,
            ctx.channel,
            line.taxCategoryId,
        );
        if (!includedRate) {
            // No tax is taken out, so the price has the same value in both forms
            return;
        }
        if (newPrice.priceIncludesTax) {
            const unchanged = roundMoney(includedRate.netPriceOf(newPrice.price)) === initialListPrice;
            line.initialListPrice = unchanged
                ? newPrice.price
                : roundMoney(includedRate.grossPriceOf(initialListPrice));
        } else {
            line.initialListPrice = roundMoney(includedRate.netPriceOf(initialListPrice));
        }
    }

    /**
     * @description
     * Applies the correct TaxRate to each OrderLine in the order.
     */
    private async applyTaxes(ctx: RequestContext, order: Order, activeZone: Zone, countryCode?: string) {
        const getTaxRate = this.createTaxRateGetter(ctx, activeZone, countryCode);
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
    }

    /**
     * @description
     * Returns a memoized function for performing an efficient
     * lookup of the correct TaxRate for a given TaxCategory.
     */
    private createTaxRateGetter(
        ctx: RequestContext,
        activeZone: Zone,
        countryCode?: string,
    ): (taxCategoryId: ID) => Promise<TaxRate> {
        const taxRateCache = new Map<ID, TaxRate>();

        return async (taxCategoryId: ID): Promise<TaxRate> => {
            const cached = taxRateCache.get(taxCategoryId);
            if (cached) {
                return cached;
            }
            const rate = await this.taxRateService.getApplicableTaxRate(
                ctx,
                { countryCode, zone: activeZone },
                taxCategoryId,
            );
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
        // Clear every line before testing any promotion. Otherwise the discounts from the previous
        // calculation still reduce the subTotal which conditions such as minimum_order_amount test.
        for (const line of order.lines) {
            line.clearAdjustments();
        }
        this.calculateOrderTotals(order);

        for (const line of order.lines) {
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
                        const { orderLineDiscountDistributionStrategy } = this.configService.orderOptions;
                        const weights = await Promise.all(
                            order.lines.map(line =>
                                orderLineDiscountDistributionStrategy.getWeight(ctx, line, order),
                            ),
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
                order.shippingLines = order.shippingLines.filter(sl => sl !== shippingLine);
                continue;
            }
            const currentMethodStillEligible = await currentShippingMethod.test(ctx, order);
            let currentMethodQuotes: ShippingCalculationResult[] = [];
            if (currentMethodStillEligible) {
                currentMethodQuotes = await currentShippingMethod.applyQuotes(ctx, order);
                // With no stored code this is the cheapest option, whose code is then stored
                const chosenOption = findShippingOption(currentMethodQuotes, shippingLine.shippingOptionCode);
                if (chosenOption) {
                    setShippingLineOption(shippingLine, currentShippingMethod, chosenOption);
                    continue;
                }
                // The chosen ShippingOption is no longer offered, or the calculator returned nothing,
                // which also leaves the ShippingMethod out of eligibleShippingMethods. Fall back to
                // the cheapest option of any eligible ShippingMethod, this one included.
            }
            const otherMethods = await this.shippingCalculator.getEligibleShippingMethods(ctx, order, [
                currentShippingMethod.id,
            ]);
            const candidates = currentMethodQuotes.length
                ? [{ method: currentShippingMethod, result: currentMethodQuotes[0] }, ...otherMethods]
                : otherMethods;
            candidates.sort((a, b) => a.result.price - b.result.price);
            const cheapest = candidates[0];
            if (cheapest) {
                setShippingLineOption(shippingLine, cheapest.method, cheapest.result);
            } else {
                order.shippingLines = order.shippingLines.filter(sl => sl !== shippingLine);
            }
        }
    }

    /**
     * @description
     * Scales down the Promotion Adjustments of each ShippingLine whose discount exceeds its price,
     * so that the discount is at most the price. For use when the Promotions are frozen but the
     * shipping price was recalculated: an Adjustment stored against a higher price would otherwise
     * make shipping negative. Does not recalculate the Order's totals.
     *
     * @since 4.0.0
     */
    capShippingDiscounts(order: Order) {
        for (const shippingLine of order.shippingLines ?? []) {
            const promotionAdjustments = (shippingLine.adjustments ?? []).filter(
                a => a.type === AdjustmentType.PROMOTION,
            );
            const discount = -promotionAdjustments.reduce((total, a) => total + a.amount, 0);
            const maxDiscount = Math.max(shippingLine.listPrice, 0);
            if (discount <= maxDiscount) {
                continue;
            }
            const factor = maxDiscount / discount;
            let remaining = maxDiscount;
            shippingLine.adjustments = shippingLine.adjustments.map(adjustment => {
                if (adjustment.type !== AdjustmentType.PROMOTION) {
                    return adjustment;
                }
                const isLast = adjustment === promotionAdjustments[promotionAdjustments.length - 1];
                // The last one takes the rounding remainder, so the discount equals the price exactly
                const amount = isLast ? remaining : Math.round(-adjustment.amount * factor);
                remaining -= amount;
                return { ...adjustment, amount: -amount };
            });
        }
    }

    /**
     * @description
     * Applies the shipping Promotions to the Order's ShippingLines again and recalculates its totals,
     * leaving everything else as it is. For use after the price of a ShippingLine was set directly,
     * without recalculating shipping.
     *
     * @since 4.0.0
     */
    async reapplyShippingPromotions(ctx: RequestContext, order: Order, promotions: Promotion[]) {
        await this.applyShippingPromotions(ctx, order, promotions);
        this.calculateOrderTotals(order);
        this.removeIneffectivePromotions(order);
        return order;
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
        const { orderTaxCalculationStrategy } = this.configService.taxOptions;
        const result = orderTaxCalculationStrategy.calculateOrderTotals(order);
        order.subTotal = result.subTotal;
        order.subTotalWithTax = result.subTotalWithTax;
        order.shipping = result.shipping;
        order.shippingWithTax = result.shippingWithTax;
    }

    private addPromotion(order: Order, promotion: Promotion) {
        if (order.promotions && !order.promotions.find(p => idsAreEqual(p.id, promotion.id))) {
            order.promotions.push(promotion);
        }
    }

    /**
     * Promotions are added to the Order as soon as their conditions pass, since a Promotion which
     * discounts nothing on one OrderLine may still discount a later line, the Order total or the
     * shipping. Once everything has been applied, any Promotion which ended up adjusting nothing
     * at all is removed again: `Order.promotions` is what the usage limits are counted from, so a
     * Promotion the customer got no benefit from must not consume a usage.
     *
     * Promotions whose actions define side effects are kept regardless, as their benefit (a free
     * gift, say) is not expressed as an adjustment amount - and on the first pass the side effect
     * has not run yet, so there is nothing to discount.
     */
    private removeIneffectivePromotions(order: Order) {
        if (!order.promotions?.length) {
            return;
        }
        const adjustmentSources = new Set<string>();
        for (const line of order.lines) {
            for (const adjustment of line.adjustments ?? []) {
                adjustmentSources.add(adjustment.adjustmentSource);
            }
        }
        for (const shippingLine of order.shippingLines ?? []) {
            for (const adjustment of shippingLine.adjustments ?? []) {
                adjustmentSources.add(adjustment.adjustmentSource);
            }
        }
        order.promotions = order.promotions.filter(
            promotion => adjustmentSources.has(promotion.getSourceId()) || promotion.hasSideEffects,
        );
    }
}
