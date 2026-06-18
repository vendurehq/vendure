import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';

import { PaymentMetadata } from '../../common/types/common-types';
import { HasCustomFields } from '../../config/index';
import { PaymentState } from '../../service/helpers/payment-state-machine/payment-state';
import { VendureEntity } from '../base/base.entity';
import { CustomPaymentFields } from '../custom-entity-fields';
import { Money } from '../money.decorator';
import { Order } from '../order/order.entity';
import { Refund } from '../refund/refund.entity';

/**
 * @description
 * A Payment represents a single payment transaction and exists in a well-defined state
 * defined by the {@link PaymentState} type.
 *
 * @docsCategory entities
 */
@Entity()
export class Payment extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<Payment>) {
        super(input);
    }

    @Column() method: string;

    @Money() amount: number;

    @Column('varchar') state: PaymentState;

    @Column({ type: 'varchar', nullable: true })
    errorMessage: string | undefined;

    @Column({ nullable: true })
    transactionId: string;

    @Column('simple-json') metadata: PaymentMetadata;

    @Index()
    @ManyToOne(type => Order, order => order.payments)
    order: Order;

    @OneToMany(type => Refund, refund => refund.payment)
    refunds: Refund[];

    @Column(type => CustomPaymentFields)
    customFields: CustomPaymentFields;
}
