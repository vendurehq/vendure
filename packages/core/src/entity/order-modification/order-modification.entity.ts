import { OrderAddress } from '@vendure/common/lib/generated-types';
import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';

import { Calculated } from '../../common/calculated-decorator';
import { VendureEntity } from '../base/base.entity';
import { Money } from '../money.decorator';
import { OrderModificationLine } from '../order-line-reference/order-modification-line.entity';
import { Order } from '../order/order.entity';
import { Payment } from '../payment/payment.entity';
import { Refund } from '../refund/refund.entity';
import { Surcharge } from '../surcharge/surcharge.entity';

/**
 * @description
 * An entity which represents a modification to an order which has been placed, and
 * then modified afterwards by an administrator.
 *
 * @docsCategory entities
 */
@Entity()
export class OrderModification extends VendureEntity {
    constructor(input?: DeepPartial<OrderModification>) {
        super(input);
    }

    @Column()
    note: string;

    @Index()
    @ManyToOne(type => Order, order => order.modifications, { onDelete: 'CASCADE' })
    order: Order;

    @OneToMany(type => OrderModificationLine, line => line.modification)
    lines: OrderModificationLine[];

    @OneToMany(type => Surcharge, surcharge => surcharge.orderModification)
    surcharges: Surcharge[];

    @Money()
    priceChange: number;

    @ManyToOne(type => Payment)
    @JoinColumn()
    payment?: Payment;

    @ManyToOne(type => Refund)
    @JoinColumn()
    refund?: Refund;

    @Column('simple-json', { nullable: true }) shippingAddressChange: OrderAddress;

    @Column('simple-json', { nullable: true }) billingAddressChange: OrderAddress;

    @Calculated()
    get isSettled(): boolean {
        if (this.priceChange === 0) {
            return true;
        }
        return !!this.payment || !!this.refund;
    }
}
