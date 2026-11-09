import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/** RFQ 样品记录（CT-02 RfqSample） */
@Entity('onebridge_rfq_sample')
export class RfqSample extends VendureEntity {
    constructor(input?: DeepPartial<RfqSample>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ type: 'int' })
    rfqId: number;

    @Column({ type: 'varchar', length: 32 })
    status: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    trackingNo: string | null;

    @Column({ nullable: true })
    confirmedAt?: Date;
}
