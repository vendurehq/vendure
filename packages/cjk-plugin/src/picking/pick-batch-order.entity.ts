import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';

import { PickBatch } from './pick-batch.entity';

@Entity('pick_batch_order')
@Unique(['batchId', 'orderId'])
export class PickBatchOrder extends VendureEntity {
    constructor(input?: DeepPartial<PickBatchOrder>) {
        super(input);
    }

    @Index()
    @Column({ type: 'integer' })
    batchId!: number;

    @ManyToOne(() => PickBatch, (b) => b.orders, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'batchId' })
    batch!: PickBatch;

    /** Vendure Order.id */
    @Index()
    @Column({ type: 'integer' })
    orderId!: number;

    @Column({ type: 'timestamptz' })
    addedAt!: Date;
}
