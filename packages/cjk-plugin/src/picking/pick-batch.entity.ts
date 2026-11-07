import { DeepPartial } from '@vendure/common/lib/shared-types';
import { VendureEntity } from '@vendure/core';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { PickBatchOrder } from './pick-batch-order.entity';

/** 拣货批次状态。REVIEWED / CANCELLED 为终态。 */
export type PickBatchState =
    | 'PENDING' | 'PICKED' | 'PRINTED' | 'SHIPPED'
    | 'HANDOVER'   // 已交接（仓内发出、交接给承运/下一环节）
    | 'REVIEWED'   // 已复核（终态）
    | 'EXCEPTION'  // 异常件待处理
    | 'CANCELLED';

@Entity('pick_batch')
export class PickBatch extends VendureEntity {
    constructor(input?: DeepPartial<PickBatch>) {
        super(input);
    }

    /** 批次号，格式 PB20260922-001（日期 + 当日 3 位序号） */
    @Index({ unique: true })
    @Column({ type: 'varchar' })
    code!: string;

    /** 归属租户渠道，用于 scoping */
    @Index()
    @Column({ type: 'varchar' })
    tenantChannelId!: string;

    /** 目标发货仓（一个批次锁一个仓） */
    @Column({ type: 'integer' })
    stockLocationId!: number;

    @Index()
    @Column({ type: 'varchar', default: 'PENDING' })
    state!: PickBatchState;

    @Column({ type: 'varchar', nullable: true })
    note!: string | null;

    /** 创建人，优先取 TenantMember.displayName */
    @Column({ type: 'varchar', nullable: true })
    createdBy!: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    pickedAt!: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    printedAt!: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    shippedAt!: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    handoverAt!: Date | null;

    /** 交接对象（承运商 / 接收人） */
    @Column({ type: 'varchar', nullable: true })
    handoverTo!: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    reviewedAt!: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    exceptionAt!: Date | null;

    /** 异常件原因（登记时必填，处理完保留） */
    @Column({ type: 'varchar', length: 1000, nullable: true })
    exceptionNote!: string | null;

    @OneToMany(() => PickBatchOrder, (o) => o.batch)
    orders!: PickBatchOrder[];
}
