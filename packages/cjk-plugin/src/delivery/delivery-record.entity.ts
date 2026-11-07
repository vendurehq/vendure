import { DeepPartial, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import { DeliveryMode, DeliveryState } from './delivery-state';

@Entity()
export class DeliveryRecord extends VendureEntity {
    constructor(input?: DeepPartial<DeliveryRecord>) {
        super(input);
    }

    @Index()
    @Column('varchar')
    orderId: ID;

    @Column({ type: 'varchar', nullable: true })
    fulfillmentId?: ID | null;

    @Index()
    @Column({ type: 'varchar', nullable: true })
    sourceLocationId?: ID | null;

    @Column({ type: 'varchar', default: 'self' })
    mode: DeliveryMode;

    @Column({ type: 'varchar', default: 'Draft' })
    status: DeliveryState;

    @Column({ type: 'varchar', nullable: true })
    expressCompany?: string | null;

    @Column({ type: 'varchar', nullable: true })
    trackingNo?: string | null;

    @Column({ type: 'varchar', nullable: true })
    staffId?: string | null;

    @Column({ type: 'varchar', nullable: true })
    staffName?: string | null;

    @Column({ type: 'varchar', nullable: true })
    receiverName?: string | null;

    @Column({ type: 'varchar', nullable: true })
    receiverPhone?: string | null;

    @Column({ type: 'varchar', nullable: true })
    receiverAddress?: string | null;

    @Column({ type: 'float', nullable: true })
    lat?: number | null;

    @Column({ type: 'float', nullable: true })
    lng?: number | null;

    @Column({ type: 'varchar', nullable: true })
    pickupLocationId?: ID | null;

    @Column({ type: 'varchar', nullable: true })
    fromLocationId?: ID | null;

    @Column({ type: 'varchar', nullable: true })
    toLocationId?: ID | null;

    /** transfer 明细 [{variantId, quantity}] */
    @Column({ type: 'text', nullable: true })
    itemsJson?: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    sentAt?: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    deliveredAt?: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    returnedAt?: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    exceptionAt?: Date | null;

    @Column({ type: 'text', nullable: true })
    photos?: string | null;

    @Column({ type: 'varchar', nullable: true })
    remark?: string | null;

    @Column({ type: 'varchar', nullable: true })
    orderBoxId?: string | null;
}
