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
        return roundMoney(this._unitPrice());
    }

    /**
     * @description
     * The price of a single unit, including tax but excluding discounts.
     */
    @Calculated()
    get unitPriceWithTax(): number {
        return roundMoney(this._unitPriceWithTax());
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
        return roundMoney(this._unitPrice() - initialPrice);
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
        return roundMoney(this._unitPriceWithTax() - initialPriceWithTax);
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
        return roundMoney(this._discountedUnitPrice());
    }

    /**
     * @description
     * The price of a single unit including discounts and tax
     */
    @Calculated()
    get discountedUnitPriceWithTax(): number {
        return roundMoney(this._discountedUnitPriceWithTax());
    }

    /**
     * @description
     * The actual unit price, taking into account both item discounts _and_ prorated (proportionally-distributed)
     * Order-level discounts. This value is the true economic value of a single unit in this OrderLine, and is used in tax
     * and refund calculations.
     */
    @Calculated()
    get proratedUnitPrice(): number {
        return roundMoney(this._proratedUnitPrice());
    }

    /**
     * @description
     * The `proratedUnitPrice` including tax.
     */
    @Calculated()
    get proratedUnitPriceWithTax(): number {
        return roundMoney(this._proratedUnitPriceWithTax());
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
        return roundMoney(this._unitPrice(), this.quantity);
    }

    /**
     * @description
     * The total price of the line including tax but excluding discounts.
     */
    @Calculated()
    get linePriceWithTax(): number {
        return roundMoney(this._unitPriceWithTax(), this.quantity);
    }

    /**
     * @description
     * The price of the line including discounts, excluding tax.
     */
    @Calculated()
    get discountedLinePrice(): number {
        // return roundMoney(this.linePrice + this.getLineAdjustmentsTotal(false, AdjustmentType.PROMOTION));
        return roundMoney(this._discountedUnitPrice(), this.quantity);
    }

    /**
     * @description
     * The price of the line including discounts and tax.
     */
    @Calculated()
    get discountedLinePriceWithTax(): number {
        return roundMoney(this._discountedUnitPriceWithTax(), this.quantity);
    }

    @Calculated()
    get discounts(): Discount[] {
        const priceIncludesTax = this.listPriceIncludesTax;
        // Group discounts together, so that it does not list a new
        // discount row for each item in the line
        const groupedDiscounts = new Map<string, Discount>();
        // See `getUnitAdjustmentsTotal()` for the quantity basis used per adjustment type. A
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
        // return roundMoney(this.linePrice + this.getLineAdjustmentsTotal(false));
        return roundMoney(this._proratedUnitPrice(), this.quantity);
    }

    /**
     * @description
     * The `proratedLinePrice` including tax.
     */
    @Calculated()
    get proratedLinePriceWithTax(): number {
        // return roundMoney(this.linePriceWithTax + this.getLineAdjustmentsTotal(true));
        return roundMoney(this._proratedUnitPriceWithTax(), this.quantity);
    }

    @Calculated()
    get proratedLineTax(): number {
        return this.proratedLinePriceWithTax - this.proratedLinePrice;
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

    private _unitPrice(): number {
        return this.listPriceIncludesTax ? netPriceOf(this.listPrice, this.taxRate) : this.listPrice;
    }

    private _unitPriceWithTax(): number {
        return this.listPriceIncludesTax ? this.listPrice : grossPriceOf(this.listPrice, this.taxRate);
    }

    private _discountedUnitPrice(): number {
        const result = this.listPrice + this.getUnitAdjustmentsTotal(AdjustmentType.PROMOTION);
        return this.listPriceIncludesTax ? netPriceOf(result, this.taxRate) : result;
    }

    private _discountedUnitPriceWithTax(): number {
        const result = this.listPrice + this.getUnitAdjustmentsTotal(AdjustmentType.PROMOTION);
        return this.listPriceIncludesTax ? result : grossPriceOf(result, this.taxRate);
    }

    /**
     * @description
     * Calculates the prorated unit price, excluding tax. This function performs no
     * rounding, so before being exposed publicly via the GraphQL API, the returned value
     * needs to be rounded to ensure it is an integer.
     */
    private _proratedUnitPrice(): number {
        const result = this.listPrice + this.getUnitAdjustmentsTotal();
        return this.listPriceIncludesTax ? netPriceOf(result, this.taxRate) : result;
    }

    /**
     * @description
     * Calculates the prorated unit price, including tax. This function performs no
     * rounding, so before being exposed publicly via the GraphQL API, the returned value
     * needs to be rounded to ensure it is an integer.
     */
    private _proratedUnitPriceWithTax(): number {
        const result = this.listPrice + this.getUnitAdjustmentsTotal();
        return this.listPriceIncludesTax ? result : grossPriceOf(result, this.taxRate);
    }

    /**
     * @description
     * The total of all price adjustments, expressed per unit. Will typically be a negative
     * number due to discounts. See `quantityBasisFor()` for the quantity basis used per
     * adjustment, which differs by `AdjustmentType`.
     */
    private getUnitAdjustmentsTotal(type?: AdjustmentType): number {
        if (!this.adjustments || this.quantity === 0) {
            return 0;
        }
        return this.adjustments
            .filter(adjustment => (type ? adjustment.type === type : true))
            .map(adjustment => adjustment.amount / this.quantityBasisFor(adjustment))
            .reduce((total, a) => total + a, 0);
    }

    /**
     * @description
     * The total of all price adjustments for the whole line. Will typically be a negative number
     * due to discounts. See `quantityBasisFor()` for the quantity basis used per adjustment.
     */
    private getLineAdjustmentsTotal(withTax: boolean, type?: AdjustmentType): number {
        if (!this.adjustments || this.quantity === 0) {
            return 0;
        }
        const sum = this.adjustments
            .filter(adjustment => (type ? adjustment.type === type : true))
            .map(adjustment => (adjustment.amount / this.quantityBasisFor(adjustment)) * this.quantity)
            .reduce((total, a) => total + a, 0);
        if (withTax) {
            return this.listPriceIncludesTax ? sum : grossPriceOf(sum, this.taxRate);
        } else {
            return this.listPriceIncludesTax ? netPriceOf(sum, this.taxRate) : sum;
        }
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
