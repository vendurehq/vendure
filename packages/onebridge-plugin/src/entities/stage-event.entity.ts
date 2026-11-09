import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { CrossBorderStage, StageEventState, StageOwnerType } from '../types';

/**
 * 阶段事件（CT-10）：业务时间轴的唯一数据源，RFQ 与订单共用。
 * 每次阶段跃迁写一条；idempotencyKey 唯一，重复回写不产生重复节点。
 */
@Entity('onebridge_stage_event')
@Index(['ownerType', 'ownerCode', 'occurredAt'])
export class StageEvent extends VendureEntity {
    constructor(input?: DeepPartial<StageEvent>) {
        super(input);
    }

    @Column({ type: 'varchar', length: 8 })
    ownerType: StageOwnerType;

    /** 归属单号（RFQ code / Order code） */
    @Column({ type: 'varchar', length: 32 })
    ownerCode: string;

    @Column({ type: 'varchar', length: 16 })
    stage: CrossBorderStage;

    @Column({ type: 'varchar', length: 100 })
    titleKr: string;

    @Column({ type: 'varchar', length: 100 })
    titleCn: string;

    @Column({ type: 'text', nullable: true })
    descKr: string | null;

    @Column({ type: 'text', nullable: true })
    descCn: string | null;

    @Column({ type: 'varchar', length: 8 })
    state: StageEventState;

    @Column()
    occurredAt: Date;

    /** 操作人（后台账号名 / system） */
    @Column({ type: 'varchar', length: 64, nullable: true })
    operator: string | null;

    /** 幂等键：轨迹/清关重复回写以唯一索引兜底 */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 128, nullable: true })
    idempotencyKey: string | null;
}
