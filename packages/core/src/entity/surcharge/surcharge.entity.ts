import { TaxLine } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Calculated } from '../../common/calculated-decorator';
import { roundMoney } from '../../common/round-money';
import { applyTaxShare, getTaxShare, grossPriceOf, netPriceOf } from '../../common/tax-utils';
import { VendureEntity } from '../base/base.entity';
import { Money } from '../money.decorator';
import { OrderModification } from '../order-modification/order-modification.entity';
import { Order } from '../order/order.entity';

/**
 * @description
 * A Surcharge represents an arbitrary extra item on an {@link Order} which is not
 * a ProductVariant. It can be used to e.g. represent payment-related surcharges.
 *
 * @docsCategory entities
 */
@Entity()
export class Surcharge extends VendureEntity {
    constructor(input?: DeepPartial<Surcharge>) {
        super(input);
    }

    @Column()
    description: string;

    @Money()
    listPrice: number;

    @Column()
    listPriceIncludesTax: boolean;

    @Column()
    sku: string;

    @Column('simple-json')
    taxLines: TaxLine[];

    // TypeORM's default 'nullify' sets `orderId` to null on every Surcharge row missing from
    // the in-memory `Order.surcharges` array, which is a snapshot from the time the Order was
    // loaded: a Surcharge added since, by an event handler or by a concurrent request, is
    // detached by the next save of that Order. `OrderService.removeSurchargeFromOrder` deletes
    // the row, so nothing needs the nullify.
    @Index()
    @ManyToOne(type => Order, order => order.surcharges, {
        onDelete: 'CASCADE',
        orphanedRowAction: 'disable',
    })
    order: Order;

    @Index()
    @ManyToOne(type => OrderModification, orderModification => orderModification.surcharges)
    orderModification: OrderModification;

    @Calculated()
    get price(): number {
        return roundMoney(
            this.listPriceIncludesTax ? this.fromListPriceBasis(this.listPrice, false) : this.listPrice,
        );
    }

    @Calculated()
    get priceWithTax(): number {
        return roundMoney(
            this.listPriceIncludesTax ? this.listPrice : this.fromListPriceBasis(this.listPrice, true),
        );
    }

    /**
     * @description
     * The price in the tax basis of `listPrice`. This is the value that the `amount` of a
     * {@link TaxLine} is a share of.
     *
     * @internal
     */
    getTaxableTotal(): number {
        return roundMoney(this.listPrice);
    }

    /**
     * Converts a value in the tax basis of `listPrice` to the other basis: from the absolute tax
     * amounts when the TaxLines have them, otherwise from the rate.
     */
    private fromListPriceBasis(value: number, withTax: boolean): number {
        const taxShare = getTaxShare(this.taxLines);
        if (taxShare != null) {
            return applyTaxShare(roundMoney(value), taxShare, withTax, roundMoney);
        }
        return withTax ? grossPriceOf(value, this.taxRate) : netPriceOf(value, this.taxRate);
    }

    @Calculated()
    get taxRate(): number {
        return summate(this.taxLines, 'taxRate');
    }
}
