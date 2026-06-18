import { TaxLine } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { Column, Entity, Index, ManyToOne } from 'typeorm';

import { Calculated } from '../../common/calculated-decorator';
import { roundMoney } from '../../common/round-money';
import { grossPriceOf, netPriceOf } from '../../common/tax-utils';
import { VendureEntity } from '../base/base.entity';
import { Money } from '../money.decorator';
import { Order } from '../order/order.entity';
import { OrderModification } from '../order-modification/order-modification.entity';

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

    @Index()
    @ManyToOne(type => Order, order => order.surcharges, { onDelete: 'CASCADE' })
    order: Order;

    @Index()
    @ManyToOne(type => OrderModification, orderModification => orderModification.surcharges)
    orderModification: OrderModification;

    @Calculated()
    get price(): number {
        return roundMoney(
            this.listPriceIncludesTax ? netPriceOf(this.listPrice, this.taxRate) : this.listPrice,
        );
    }

    @Calculated()
    get priceWithTax(): number {
        return roundMoney(
            this.listPriceIncludesTax ? this.listPrice : grossPriceOf(this.listPrice, this.taxRate),
        );
    }

    @Calculated()
    get taxRate(): number {
        return summate(this.taxLines, 'taxRate');
    }
}
