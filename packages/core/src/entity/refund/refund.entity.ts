import { DeepPartial, ID } from '@vendure/common/lib/shared-types';
import { Column, Entity, Index, JoinColumn, JoinTable, ManyToOne, OneToMany } from 'typeorm';

import { PaymentMetadata } from '../../common/types/common-types';
import { HasCustomFields } from '../../config/custom-field/custom-field-types';
import { RefundState } from '../../service/helpers/refund-state-machine/refund-state';
import { VendureEntity } from '../base/base.entity';
import { CustomRefundFields } from '../custom-entity-fields';
import { EntityId } from '../entity-id.decorator';
import { Money } from '../money.decorator';
import { RefundLine } from '../order-line-reference/refund-line.entity';
import { Payment } from '../payment/payment.entity';

/**
 * @description A refund the belongs to an order
 *
 * @docsCategory entities
 */
@Entity()
export class Refund extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<Refund>) {
        super(input);
    }

    /**
     * @deprecated Since v2.2, the `items` field will not be used by default. Instead, the `total` field
     * alone will be used to determine the refund amount.
     */
    @Money() items: number;

    /**
     * @deprecated Since v2.2, the `shipping` field will not be used by default. Instead, the `total` field
     * alone will be used to determine the refund amount.
     */
    @Money() shipping: number;

    /**
     * @deprecated Since v2.2, the `adjustment` field will not be used by default. Instead, the `total` field
     * alone will be used to determine the refund amount.
     */
    @Money() adjustment: number;

    @Money() total: number;

    @Column() method: string;

    @Column({ nullable: true }) reason: string;

    @Column('varchar') state: RefundState;

    @Column({ nullable: true }) transactionId: string;

    @OneToMany(type => RefundLine, line => line.refund)
    @JoinTable()
    lines: RefundLine[];

    @Index()
    @ManyToOne(type => Payment, payment => payment.refunds)
    @JoinColumn()
    payment: Payment;

    @EntityId()
    paymentId: ID;

    @Column('simple-json') metadata: PaymentMetadata;

    @Column(type => CustomRefundFields)
    customFields: CustomRefundFields;
}
