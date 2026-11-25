import { Adjustment, AdjustmentType, Discount, TaxLine } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

import { Calculated } from '../../common/calculated-decorator';
import { roundMoney } from '../../common/round-money';
import { grossPriceOf, netPriceOf } from '../../common/tax-utils';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { Asset } from '../asset/asset.entity';
import { VendureEntity } from '../base/base.entity';
import { Channel } from '../channel/channel.entity';
import { CustomOrderLineFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { Money } from '../money.decorator';
import { OrderLineReference } from '../order-line-reference/order-line-reference.entity';
import type { QuotedLineCancellation } from '../order-line-reference/quoted-line-cancellation.entity';
import { Order } from '../order/order.entity';
import { ProductVariant } from '../product-variant/product-variant.entity';
import { ShippingLine } from '../shipping-line/shipping-line.entity';
import { Allocation } from '../stock-movement/allocation.entity';
import { Cancellation } from '../stock-movement/cancellation.entity';
import { Sale } from '../stock-movement/sale.entity';
import { TaxCategory } from '../tax-category/tax-category.entity';

/**
 * @description
 * A single line on an {@link Order} which contains information about the {@link ProductVariant} and
 * quantity ordered, as well as the price and tax information.
 *
 * @docsCategory entities
 */
@Entity()
export class OrderLine extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<OrderLine>) {
        super(input);
    }

    /**
     * @description
     * The {@link Channel} of the {@link Seller} for a multivendor setup.
     */
    @Index()
    @ManyToOne(type => Channel, { nullable: true, onDelete: 'SET NULL' })
    sellerChannel?: Channel;

    @EntityId({ nullable: true })
    sellerChannelId?: ID;

    /**
     * @description
     * The {@link ShippingLine} to which this line has been assigned.
     * This is determined by the configured {@link ShippingLineAssignmentStrategy}.
     */
    @Index()
    @ManyToOne(type => ShippingLine, shippingLine => shippingLine.orderLines, {
        nullable: true,
        onDelete: 'SET NULL',
    })
    shippingLine?: ShippingLine;

    @EntityId({ nullable: true })
    shippingLineId?: ID;

    /**
     * @description
     * The {@link ProductVariant} which is being ordered.
     */
    @Index()
    @ManyToOne(type => ProductVariant, productVariant => productVariant.lines, { onDelete: 'CASCADE' })
    productVariant: ProductVariant;

    @EntityId()
    productVariantId: ID;

    @Index()
    @ManyToOne(type => TaxCategory)
    taxCategory: TaxCategory;

    @EntityId({ nullable: true })
    taxCategoryId: ID;

    @Index()
    @ManyToOne(type => Asset, asset => asset.featuredInVariants, { onDelete: 'SET NULL' })
    featuredAsset: Asset;

    @Index()
    @ManyToOne(type => Order, order => order.lines, { onDelete: 'CASCADE' })
    order: Order;

    @OneToMany(type => OrderLineReference, lineRef => lineRef.orderLine)
    linesReferences: OrderLineReference[];

    @OneToMany(type => Sale, sale => sale.orderLine)
    sales: Sale[];

    @Column()
    quantity: number;

    /**
     * @description
     * The quantity of this OrderLine at the time the order was placed (as per the {@link OrderPlacedStrategy}).
     */
    @Column({ default: 0 })
    orderPlacedQuantity: number;

    /**
     * @description
     * The price as calculated when the OrderLine was first added to the Order. Usually will be identical to the
     * `listPrice`, except when the ProductVariant price has changed in the meantime and a re-calculation of
     * the Order has been performed.
     */
    @Money({ nullable: true })
    initialListPrice: number;

    /**
     * @description
     * This is the price as listed by the ProductVariant (and possibly modified by the {@link OrderItemPriceCalculationStrategy}),
     * which, depending on the current Channel, may or may not include tax.
     */
    @Money()
    listPrice: number;

    /** Total returned by calculateLinePrice, in the same tax basis as listPrice. */
    @Money({ nullable: true })
    quotedLinePrice?: number | null;
    /** Quantity covered by the quote, retained when items are cancelled. */
    @Column({ type: 'int', nullable: true })
    quotedQuantity?: number | null;
    @OneToMany('QuotedLineCancellation', 'orderLine', { persistence: false })
    quotedCancellations: QuotedLineCancellation[];

    /**
     * @description
     * Whether the listPrice includes tax, which depends on the settings of the current Channel.
     */
    @Column()
    listPriceIncludesTax: boolean;

    @Column('simple-json')
    adjustments: Adjustment[];

    @Column('simple-json')
    taxLines: TaxLine[];

    @OneToMany(type => Cancellation, cancellation => cancellation.orderLine)
    cancellations: Cancellation[];

    @OneToMany(type => Allocation, allocation => allocation.orderLine)
    allocations: Allocation[];

    @Column(type => CustomOrderLineFields)
    customFields: CustomOrderLineFields;

    /**
     * @description
     * The price of a single unit, excluding tax and discounts.
     */
    @Calculated()
    get unitPrice(): number {
        return this.getPrice(false, 1);
    }

    /**
     * @description
     * The price of a single unit, including tax but excluding discounts.
     */
    @Calculated()
    get unitPriceWithTax(): number {
        return this.getPrice(true, 1);
    }

    /**
     * @description
     * Non-zero if the `unitPrice` has changed since it was initially added to Order.
     */
    @Calculated()
    get unitPriceChangeSinceAdded(): number {
        const { initialListPrice, listPriceIncludesTax } = this;
        const initialPrice = listPriceIncludesTax
            ? netPriceOf(initialListPrice, this.taxRate)
            : initialListPrice;
        return roundMoney(this.withTaxBasis(this.listPrice, false) - initialPrice);
    }

    /**
     * @description
     * Non-zero if the `unitPriceWithTax` has changed since it was initially added to Order.
     */
    @Calculated()
    get unitPriceWithTaxChangeSinceAdded(): number {
        const { initialListPrice, listPriceIncludesTax } = this;
        const initialPriceWithTax = listPriceIncludesTax
            ? initialListPrice
            : grossPriceOf(initialListPrice, this.taxRate);
        return roundMoney(this.withTaxBasis(this.listPrice, true) - initialPriceWithTax);
    }

    /**
     * @description
     * The price of a single unit including discounts, excluding tax.
     *
     * If Order-level discounts have been applied, this will not be the
     * actual taxable unit price (see `proratedUnitPrice`), but is generally the
     * correct price to display to customers to avoid confusion
     * about the internal handling of distributed Order-level discounts.
     */
    @Calculated()
    get discountedUnitPrice(): number {
        return this.getPrice(false, 1, AdjustmentType.PROMOTION);
    }

    /**
     * @description
     * The price of a single unit including discounts and tax
     */
    @Calculated()
    get discountedUnitPriceWithTax(): number {
        return this.getPrice(true, 1, AdjustmentType.PROMOTION);
    }

    /**
     * @description
     * The actual unit price, taking into account both item discounts _and_ prorated (proportionally-distributed)
     * Order-level discounts. This value is the true economic value of a single unit in this OrderLine, and is used in tax
     * and refund calculations.
     */
    @Calculated()
    get proratedUnitPrice(): number {
        return this.getPrice(false, 1, 'all');
    }

    /**
     * @description
     * The `proratedUnitPrice` including tax.
     */
    @Calculated()
    get proratedUnitPriceWithTax(): number {
        return this.getPrice(true, 1, 'all');
    }

    @Calculated()
    get unitTax(): number {
        return this.unitPriceWithTax - this.unitPrice;
    }

    @Calculated()
    get proratedUnitTax(): number {
        return this.proratedUnitPriceWithTax - this.proratedUnitPrice;
    }

    @Calculated()
    get taxRate(): number {
        return summate(this.taxLines, 'taxRate');
    }

    /**
     * @description
     * The total price of the line excluding tax and discounts.
     */
    @Calculated()
    get linePrice(): number {
        return this.getPrice(false, this.quantity);
    }

    /**
     * @description
     * The total price of the line including tax but excluding discounts.
     */
    @Calculated()
    get linePriceWithTax(): number {
        return this.getPrice(true, this.quantity);
    }

    /**
     * @description
     * The price of the line including discounts, excluding tax.
     */
    @Calculated()
    get discountedLinePrice(): number {
        return this.getPrice(false, this.quantity, AdjustmentType.PROMOTION);
    }

    /**
     * @description
     * The price of the line including discounts and tax.
     */
    @Calculated()
    get discountedLinePriceWithTax(): number {
        return this.getPrice(true, this.quantity, AdjustmentType.PROMOTION);
    }

    @Calculated()
    get discounts(): Discount[] {
        const priceIncludesTax = this.listPriceIncludesTax;
        // Group discounts together, so that it does not list a new
        // discount row for each item in the line
        const groupedDiscounts = new Map<string, Discount>();
        // See `quantityBasisFor()` for the quantity basis used per adjustment type. A
        // quantity of 0 (e.g. a fully-cancelled line added by an OrderModification, which keeps
        // `orderPlacedQuantity` at 0 too, per #5097) has no units left to hold a discount,
        // regardless of what the stored adjustment amount is.
        for (const adjustment of this.adjustments) {
            const discountGroup = groupedDiscounts.get(adjustment.adjustmentSource);
            const lineAdjustmentAmount =
                this.quantity === 0
                    ? 0
                    : (adjustment.amount / this.quantityBasisFor(adjustment)) * this.quantity;
            const amount = priceIncludesTax
                ? netPriceOf(lineAdjustmentAmount, this.taxRate)
                : lineAdjustmentAmount;
            const amountWithTax = priceIncludesTax
                ? lineAdjustmentAmount
                : grossPriceOf(lineAdjustmentAmount, this.taxRate);
            if (discountGroup) {
                discountGroup.amount += amount;
                discountGroup.amountWithTax += amountWithTax;
            } else {
                groupedDiscounts.set(adjustment.adjustmentSource, {
                    ...(adjustment as Omit<Adjustment, '__typename'>),
                    amount: roundMoney(amount),
                    amountWithTax: roundMoney(amountWithTax),
                });
            }
        }
        return [...groupedDiscounts.values()];
    }

    /**
     * @description
     * The total tax on this line.
     */
    @Calculated()
    get lineTax(): number {
        return this.linePriceWithTax - this.linePrice;
    }

    /**
     * @description
     * The actual line price, taking into account both item discounts _and_ prorated (proportionally-distributed)
     * Order-level discounts. This value is the true economic value of the OrderLine, and is used in tax
     * and refund calculations.
     */
    @Calculated()
    get proratedLinePrice(): number {
        return this.getPrice(false, this.quantity, 'all');
    }

    /**
     * @description
     * The `proratedLinePrice` including tax.
     */
    @Calculated()
    get proratedLinePriceWithTax(): number {
        return this.getPrice(true, this.quantity, 'all');
    }

    @Calculated({ relations: ['quotedCancellations'] })
    get refundPriceParts(): Array<{ priceWithTax: number; quantity: number }> {
        const cancellations = this.quotedCancellations ?? [];
        if (this.quotedLinePrice == null && !cancellations.length) {
            return [];
        }
        const parts = cancellations
            .slice()
            .sort(
                (a, b) =>
                    a.createdAt.getTime() - b.createdAt.getTime() || String(a.id).localeCompare(String(b.id)),
            )
            .map(({ priceWithTax, quantity }) => ({ priceWithTax, quantity }));
        if (this.quantity > 0) {
            parts.push({ priceWithTax: this.proratedLinePriceWithTax, quantity: this.quantity });
        }
        return parts;
    }

    @Calculated()
    get proratedLineTax(): number {
        return this.proratedLinePriceWithTax - this.proratedLinePrice;
    }

    /** Convert a promotion amount in the channel's tax basis to the stored quote's tax basis. */
    getAdjustmentAmount(amount: number, includesTax: boolean): number {
        // Existing unit-price strategies keep their historical promotion tax treatment.
        if (this.quotedLinePrice == null) {
            return amount;
        }
        if (includesTax === this.listPriceIncludesTax) {
            return roundMoney(amount);
        }
        return roundMoney(
            includesTax ? netPriceOf(amount, this.taxRate) : grossPriceOf(amount, this.taxRate),
        );
    }

    addAdjustment(adjustment: Adjustment) {
        // We should not allow adding adjustments which would
        // result in a negative unit price
        const maxDiscount =
            (this.listPriceIncludesTax ? this.proratedLinePriceWithTax : this.proratedLinePrice) * -1;
        const limitedAdjustment: Adjustment = {
            ...adjustment,
            amount: Math.max(maxDiscount, adjustment.amount),
        };
        if (limitedAdjustment.amount !== 0) {
            this.adjustments = this.adjustments.concat(limitedAdjustment);
        }
    }

    /**
     * @description
     * Sets this line's quantity to `newQuantity`, rescaling its `PROMOTION`-type adjustments to
     * match. Used where a quantity reduction bypasses `OrderCalculator` recalculation (see
     * `OrderModifier.cancelOrderByOrderLines()`), to preserve the invariant that `PROMOTION`
     * amounts are stored scaled to the current quantity.
     *
     * A `newQuantity` of 0 sets the quantity but leaves the adjustments untouched: the getters
     * short-circuit on an empty line either way, so scaling them to zero would only erase the
     * record of the discount that had applied, which plugins and accounting exports read back.
     */
    setQuantityRescalingAdjustments(newQuantity: number) {
        if (0 < newQuantity) {
            const scaleFactor = newQuantity / this.quantity;
            this.adjustments = (this.adjustments ?? []).map(adjustment =>
                adjustment.type === AdjustmentType.PROMOTION
                    ? { ...adjustment, amount: roundMoney(adjustment.amount * scaleFactor) }
                    : adjustment,
            );
        }
        this.quantity = newQuantity;
    }

    /**
     * Clears Adjustments from all OrderItems of the given type. If no type
     * is specified, then all adjustments are removed.
     */
    clearAdjustments(type?: AdjustmentType) {
        if (!type) {
            this.adjustments = [];
        } else {
            this.adjustments = this.adjustments ? this.adjustments.filter(a => a.type !== type) : [];
        }
    }

    /** Unit basis for promotion calculations, before rounding a quoted unit for display. */
    getUnitPriceForPromotion(withTax: boolean): number {
        if (this.quotedLinePrice != null && this.quotedQuantity) {
            return this.withTaxBasis(this.quotedLinePrice / this.quotedQuantity, withTax);
        }
        return withTax ? this.unitPriceWithTax : this.unitPrice;
    }

    private getPrice(
        withTax: boolean,
        quantity: number,
        adjustments?: AdjustmentType.PROMOTION | 'all',
    ): number {
        const { quotedLinePrice, quotedQuantity } = this;
        const quoted = quotedLinePrice != null && quotedQuantity != null && quotedQuantity > 0;
        const amount = quoted ? this.scaleAmount(quotedLinePrice, quantity, quotedQuantity) : this.listPrice;
        let adjustmentTotal = 0;
        if (adjustments && this.quantity > 0) {
            for (const adjustment of this.adjustments ?? []) {
                if (adjustments === 'all' || adjustments === adjustment.type) {
                    const basis = this.quantityBasisFor(adjustment);
                    adjustmentTotal += quoted
                        ? this.scaleAmount(adjustment.amount, quantity, basis)
                        : adjustment.amount / basis;
                }
            }
        }
        // Rescaled promotions are rounded to whole units, so they can exceed the scaled quote.
        const total = quoted ? Math.max(0, amount + adjustmentTotal) : amount + adjustmentTotal;
        return roundMoney(this.withTaxBasis(total, withTax), quoted ? 1 : quantity);
    }

    private scaleAmount(amount: number, quantity: number, basis: number): number {
        return quantity === basis ? amount : (amount * quantity) / basis;
    }

    private withTaxBasis(amount: number, withTax: boolean): number {
        if (!!this.listPriceIncludesTax === withTax) {
            return amount;
        }
        return withTax ? grossPriceOf(amount, this.taxRate) : netPriceOf(amount, this.taxRate);
    }

    /**
     * @description
     * The quantity that `adjustment.amount` (a line total) should be divided by to get a correct
     * per-unit share. `PROMOTION` adjustments are always freshly recomputed against the current
     * `this.quantity`, so that is their basis. Other types (`DISTRIBUTED_ORDER_PROMOTION`, `OTHER`)
     * are a per-line share of an order-level amount that is redistributed by weight on every
     * recalculation, so their basis is pinned to `orderPlacedQuantity` - otherwise a partially
     * cancelled/refunded line's surviving units could absorb a bigger share than they're due. See
     * #5127 for the full reasoning.
     */
    private quantityBasisFor(adjustment: Adjustment): number {
        const basis = (() => {
            switch (adjustment.type) {
                case AdjustmentType.PROMOTION:
                    return this.quantity;
                case AdjustmentType.DISTRIBUTED_ORDER_PROMOTION:
                case AdjustmentType.OTHER:
                default:
                    return Math.max(this.orderPlacedQuantity, this.quantity);
            }
        })();
        // An empty line has no units to divide across; every caller discards the result in that
        // case, and 1 keeps a future caller that forgets from producing NaN (cf. #5101).
        return basis === 0 ? 1 : basis;
    }
}
