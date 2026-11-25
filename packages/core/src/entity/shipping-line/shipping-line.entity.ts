import { Adjustment, Discount, TaxLine } from '@vendure/common/lib/generated-types';
import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

import { Calculated } from '../../common/calculated-decorator';
import { roundMoney } from '../../common/round-money';
import { convertTaxBasis } from '../../common/tax-utils';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { VendureEntity } from '../base/base.entity';
import { CustomShippingLineFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { Money } from '../money.decorator';
import { OrderLine } from '../order-line/order-line.entity';
import { Order } from '../order/order.entity';
import { ShippingMethod } from '../shipping-method/shipping-method.entity';

/**
 * @description
 * A ShippingLine is created when a {@link ShippingMethod} is applied to an {@link Order}.
 * It contains information about the price of the shipping method, any discounts that were
 * applied, and the resulting tax on the shipping method.
 *
 * @docsCategory entities
 */
@Entity()
export class ShippingLine extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<ShippingLine>) {
        super(input);
    }

    @EntityId()
    shippingMethodId: ID | null;

    @Index()
    @ManyToOne(type => ShippingMethod)
    shippingMethod: ShippingMethod;

    @Index()
    @ManyToOne(type => Order, order => order.shippingLines, { onDelete: 'CASCADE' })
    order: Order;

    @Money()
    listPrice: number;

    @Column()
    listPriceIncludesTax: boolean;

    @Column('simple-json')
    adjustments: Adjustment[];

    @Column('simple-json')
    taxLines: TaxLine[];

    @OneToMany(type => OrderLine, orderLine => orderLine.shippingLine)
    orderLines: OrderLine[];

    @Column(type => CustomShippingLineFields)
    customFields: CustomShippingLineFields;

    @Calculated()
    get price(): number {
        return this.listPriceIncludesTax ? this.fromListPriceBasis(this.listPrice, false) : this.listPrice;
    }

    @Calculated()
    get priceWithTax(): number {
        return roundMoney(
            this.listPriceIncludesTax ? this.listPrice : this.fromListPriceBasis(this.listPrice, true),
        );
    }

    @Calculated()
    get discountedPrice(): number {
        const result = this.listPrice + this.getAdjustmentsTotal();
        return roundMoney(this.listPriceIncludesTax ? this.fromListPriceBasis(result, false) : result);
    }

    @Calculated()
    get discountedPriceWithTax(): number {
        const result = this.listPrice + this.getAdjustmentsTotal();
        return roundMoney(this.listPriceIncludesTax ? result : this.fromListPriceBasis(result, true));
    }

    @Calculated()
    get taxRate(): number {
        return summate(this.taxLines, 'taxRate');
    }

    @Calculated()
    get discounts(): Discount[] {
        return (
            this.adjustments?.map(adjustment => {
                const amount = roundMoney(
                    this.listPriceIncludesTax
                        ? this.fromListPriceBasis(adjustment.amount, false)
                        : adjustment.amount,
                );
                const amountWithTax = roundMoney(
                    this.listPriceIncludesTax
                        ? adjustment.amount
                        : this.fromListPriceBasis(adjustment.amount, true),
                );
                return {
                    ...(adjustment as Omit<Adjustment, '__typename'>),
                    amount,
                    amountWithTax,
                };
            }) ?? []
        );
    }

    addAdjustment(adjustment: Adjustment) {
        this.adjustments = this.adjustments.concat(adjustment);
    }

    clearAdjustments() {
        this.adjustments = [];
    }

    /**
     * @description
     * The discounted price in the tax basis of `listPrice`. This is the value that the `amount` of
     * a {@link TaxLine} is a share of.
     *
     * @internal
     */
    getTaxableTotal(): number {
        return roundMoney(this.listPrice + this.getAdjustmentsTotal());
    }

    /**
     * @description
     * The total of all price adjustments. Will typically be a negative number due to discounts.
     */
    private getAdjustmentsTotal(): number {
        return summate(this.adjustments, 'amount');
    }

    private fromListPriceBasis(value: number, withTax: boolean): number {
        return convertTaxBasis(value, withTax, this.taxLines, this.taxRate);
    }
}
