import { Injectable } from '@nestjs/common';
import { filterAsync } from '@vendure/common/lib/filter-async';
import { AdjustmentType, TaxLine } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { CacheKey } from '../../../common/constants';
import { InternalServerError } from '../../../common/error/errors';
import { Instrument } from '../../../common/instrument-decorator';
import { hasTaxAmounts, StoredTaxLine, taxAmountsApply, withoutTaxAmounts } from '../../../common/tax-utils';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { OrderLine, TaxRate } from '../../../entity';
import { Order } from '../../../entity/order/order.entity';
import { Promotion } from '../../../entity/promotion/promotion.entity';
import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { Surcharge } from '../../../entity/surcharge/surcharge.entity';
import { Zone } from '../../../entity/zone/zone.entity';
import { ShippingMethodService } from '../../services/shipping-method.service';
import { TaxRateService } from '../../services/tax-rate.service';
import { ZoneService } from '../../services/zone.service';
import { ShippingCalculator } from '../shipping-calculator/shipping-calculator';

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
     * Asks the TaxLineCalculationStrategy again for the tax of every OrderLine, ShippingLine and
     * Surcharge, and replaces the absolute tax amounts of a placed Order even where the item did not
     * change. Use it when the
     * tax may differ for an unchanged line, for example after a change of address. Defaults to
     * `false`, so a placed Order keeps the tax amounts that were paid.
     *
     * @since 3.9.0
     */
    recalculateTax?: boolean;
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
        const { taxZoneStrategy } = this.configService.taxOptions;
        // We reset the promotions array as all promotions
        // must be revalidated on any changes to an Order.
        order.promotions = [];
        const zones = await this.zoneService.getAllWithMembers(ctx);
        const activeTaxZone = await this.requestContextCache.get(
            ctx,
            CacheKey.ActiveTaxZone(ctx.channelId),
            () => taxZoneStrategy.determineTaxZone(ctx, zones, ctx.channel, order),
        );

        let taxZoneChanged = false;
        if (!activeTaxZone) {
            throw new InternalServerError('error.no-active-tax-zone');
        }
        if (!order.taxZoneId || !idsAreEqual(order.taxZoneId, activeTaxZone.id)) {
            order.taxZoneId = activeTaxZone.id;
            taxZoneChanged = true;
        }
        // Absolute tax amounts from the TaxLineCalculationStrategy are held aside while promotions
        // are tested and applied, so that promotions always judge the Order on the tax that the
        // rates give. Otherwise a promotion could see a total that depends on whether it applied
        // in the previous calculation, and turn on and off on every recalculation.
        const recalculateTax = options?.recalculateTax === true;
        const settledTaxAmounts = this.detachTaxAmounts(order.lines);
        const linesWithTaxAmounts = new Set(settledTaxAmounts.keys());
        const settledItemTaxAmounts = this.detachTaxAmounts([
            ...(order.shippingLines ?? []),
            ...(order.surcharges ?? []),
        ]);
        if (recalculateTax || taxZoneChanged) {
            settledTaxAmounts.clear();
            settledItemTaxAmounts.clear();
        }
        const providedTaxAmounts = new Map<OrderLine, TaxLine[] | null>();
        const getTaxRate = this.createTaxRateGetter(ctx, activeTaxZone);
        for (const updatedOrderLine of updatedOrderLines) {
            await this.applyTaxesToOrderLine(ctx, order, updatedOrderLine, getTaxRate, providedTaxAmounts);
        }
        this.calculateOrderTotals(order);
        if (order.lines.length) {
            if (taxZoneChanged || recalculateTax) {
                // First apply taxes to the non-discounted prices
                await this.applyTaxes(ctx, order, activeTaxZone, providedTaxAmounts);
            }

            // Then test and apply promotions
            const totalBeforePromotions = order.subTotal;
            await this.applyPromotions(ctx, order, promotions);

            if (order.subTotal !== totalBeforePromotions) {
                // Finally, re-calculate taxes because the promotions may have
                // altered the unit prices, which in turn will alter the tax payable.
                await this.applyTaxes(ctx, order, activeTaxZone, providedTaxAmounts);
            }
            // An external system may spread rounding differences across the lines of an order, so in
            // a cart whose lines changed, the amounts of the unchanged lines are not kept either.
            const keepSettled =
                !!order.orderPlacedAt || !this.orderLinesChanged(order, updatedOrderLines, settledTaxAmounts);
            if (!keepSettled) {
                settledTaxAmounts.clear();
                settledItemTaxAmounts.clear();
            }
            // Shipping is judged on the final tax, as are the eligibility checks outside this method.
            await this.attachTaxAmounts(
                ctx,
                order,
                settledTaxAmounts,
                providedTaxAmounts,
                getTaxRate,
                linesWithTaxAmounts,
            );
            this.calculateOrderTotals(order);
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
        if (recalculateShippingPromotions) {
            await this.applyShippingPromotions(ctx, order, promotions);
        }
        await this.applyItemTaxAmounts(ctx, order, settledItemTaxAmounts);
        this.calculateOrderTotals(order);
        this.removeIneffectivePromotions(order);
        return order;
    }

    /**
     * @description
     * Applies the correct TaxRate to each OrderLine in the order.
     */
    private async applyTaxes(
        ctx: RequestContext,
        order: Order,
        activeZone: Zone,
        providedTaxAmounts?: Map<OrderLine, TaxLine[] | null>,
    ) {
        const getTaxRate = this.createTaxRateGetter(ctx, activeZone);
        for (const line of order.lines) {
            await this.applyTaxesToOrderLine(ctx, order, line, getTaxRate, providedTaxAmounts);
        }
        this.calculateOrderTotals(order);
    }

    /**
     * Whether lines were added to, removed from or repriced in the Order since the stored tax amounts
     * were given.
     */
    private orderLinesChanged(
        order: Order,
        updatedOrderLines: OrderLine[],
        settled: ReadonlyMap<OrderLine, StoredTaxLine[]>,
    ): boolean {
        if (updatedOrderLines.length) {
            return true;
        }
        return order.lines.some(line => {
            const stored = settled.get(line);
            return (
                !!stored &&
                (stored[0].taxBase !== line.getTaxableLineTotal() ||
                    (stored[0].orderLineCount != null && stored[0].orderLineCount !== order.lines.length))
            );
        });
    }

    /**
     * Removes the absolute tax amounts from the OrderLines, so that their tax is derived from the
     * rates, and returns the TaxLines with the amounts.
     */
    private detachTaxAmounts<T extends { taxLines: TaxLine[] }>(lines: T[]): Map<T, TaxLine[]> {
        const detached = new Map<T, TaxLine[]>();
        for (const line of lines) {
            if (hasTaxAmounts(line.taxLines)) {
                detached.set(line, line.taxLines);
                line.taxLines = withoutTaxAmounts(line.taxLines);
            }
        }
        return detached;
    }

    /**
     * Gives each OrderLine back its absolute tax amounts, if they apply to its final taxable total:
     * the amounts the TaxLineCalculationStrategy returned in this calculation, or the ones the line
     * had before it. A placed Order prefers the amounts it had, which are the ones that were paid,
     * so a strategy that answers differently today does not change an unchanged line. A line whose
     * amounts no longer apply is asked again for its final total.
     */
    private async attachTaxAmounts(
        ctx: RequestContext,
        order: Order,
        settled: Map<OrderLine, TaxLine[]>,
        provided: Map<OrderLine, TaxLine[] | null>,
        getTaxRate: (taxCategoryId: ID) => Promise<TaxRate>,
        hadTaxAmounts: ReadonlySet<OrderLine>,
    ) {
        for (const line of order.lines) {
            const candidates = order.orderPlacedAt
                ? [settled.get(line), provided.get(line)]
                : [provided.get(line), settled.get(line)];
            if (!candidates.some(candidate => candidate) && !hadTaxAmounts.has(line)) {
                continue;
            }
            const taxableTotal = line.getTaxableLineTotal();
            const applicable = candidates.find(
                candidate => candidate && taxAmountsApply(candidate, taxableTotal, line.taxLines),
            );
            if (applicable) {
                line.taxLines = applicable;
            } else if (provided.get(line) !== null) {
                await this.applyTaxesToOrderLine(ctx, order, line, getTaxRate);
            }
            // Otherwise the strategy was asked about this line in this calculation and returned no
            // amounts, for example because the ERP is unavailable, so it is not asked again.
        }
    }

    /**
     * Gives ShippingLines and Surcharges absolute tax amounts from the TaxLineCalculationStrategy,
     * if it implements the optional methods for them. An item keeps the amounts it had while its
     * taxable total and rates are unchanged, so the strategy is only asked about items that changed.
     */
    private async applyItemTaxAmounts(
        ctx: RequestContext,
        order: Order,
        settled: Map<ShippingLine | Surcharge, TaxLine[]>,
    ) {
        const { taxLineCalculationStrategy: strategy } = this.configService.taxOptions;
        const items: Array<ShippingLine | Surcharge> = [
            ...(order.shippingLines ?? []),
            ...(order.surcharges ?? []),
        ];
        for (const item of items) {
            const previous = settled.get(item);
            if (previous && taxAmountsApply(previous, item.getTaxableTotal(), item.taxLines)) {
                item.taxLines = previous;
                continue;
            }
            const taxLines =
                item instanceof Surcharge
                    ? await strategy.calculateSurchargeTaxLines?.({
                          ctx,
                          order,
                          surcharge: item,
                          taxLines: item.taxLines,
                      })
                    : await strategy.calculateShippingLineTaxLines?.({
                          ctx,
                          order,
                          shippingLine: item,
                          taxLines: item.taxLines,
                      });
            if (taxLines) {
                item.taxLines = withTaxBase(taxLines, () => item.getTaxableTotal());
            }
        }
    }

    /**
     * Applies the TaxLines from the TaxLineCalculationStrategy to the line. If `providedTaxAmounts`
     * is given, absolute tax amounts are recorded there instead of on the line, to be attached
     * once the line's taxable total is final, and a line that gave no amounts is recorded as null.
     */
    private async applyTaxesToOrderLine(
        ctx: RequestContext,
        order: Order,
        line: OrderLine,
        getTaxRate: (taxCategoryId: ID) => Promise<TaxRate>,
        providedTaxAmounts?: Map<OrderLine, TaxLine[] | null>,
    ) {
        const applicableTaxRate = await getTaxRate(line.taxCategoryId);
        const { taxLineCalculationStrategy } = this.configService.taxOptions;
        const taxLines = await taxLineCalculationStrategy.calculate({
            ctx,
            applicableTaxRate,
            order,
            orderLine: line,
        });
        const withBase = withTaxBase(taxLines, () => line.getTaxableLineTotal(), order.lines.length);
        if (!hasTaxAmounts(withBase)) {
            // Records that the line was asked, and gave no amounts.
            providedTaxAmounts?.set(line, null);
            line.taxLines = taxLines;
            return;
        }
        if (providedTaxAmounts) {
            providedTaxAmounts.set(line, withBase);
            line.taxLines = withoutTaxAmounts(withBase);
        } else {
            line.taxLines = withBase;
        }
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
                        line.addAdjustment({
                            ...adjustment,
                            amount: line.getAdjustmentAmount(adjustment.amount, ctx.channel.pricesIncludeTax),
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
                            const shareOfAmount = line.getAdjustmentAmount(
                                distribution[i],
                                ctx.channel.pricesIncludeTax,
                            );
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

/**
 * Checks the absolute tax amounts that a TaxLineCalculationStrategy returned, and records on each
 * TaxLine the taxable total that the amounts apply to, so that the tax of any part of the item can
 * be derived later, such as the units that remain after a partial cancellation.
 */
function withTaxBase(taxLines: TaxLine[], getTaxableTotal: () => number, orderLineCount?: number): TaxLine[] {
    const amounts = taxLines.filter(taxLine => taxLine.amount != null).length;
    if (!amounts) {
        return taxLines;
    }
    if (amounts !== taxLines.length) {
        throw new InternalServerError(
            'TaxLineCalculationStrategy must set an amount on all or none of the TaxLines of an item',
        );
    }
    if (taxLines.some(taxLine => !Number.isSafeInteger(taxLine.amount))) {
        throw new InternalServerError('TaxLineCalculationStrategy must return integer tax amounts');
    }
    const taxBase = getTaxableTotal();
    return taxLines.map(
        (taxLine): StoredTaxLine =>
            orderLineCount == null ? { ...taxLine, taxBase } : { ...taxLine, taxBase, orderLineCount },
    );
}
