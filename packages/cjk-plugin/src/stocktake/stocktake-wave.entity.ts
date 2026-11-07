import { Column, Entity, Index } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';

/**
 * 盘次状态（规格 §4.2/§5）。
 * 说明：规格 §4.2 的枚举里含 `RELEASED`，本实现**不落库该状态** —— 「释放」语义 =
 * 回到 `OPEN` 且清空 assigneeId（可再次被认领），用状态 + 负责人两个字段即可表达，
 * 不额外增加一个瞬时状态（详见末节「自审记录」的类型一致性核对）。
 */
export type StocktakeWaveState = 'OPEN' | 'CLAIMED' | 'COUNTING' | 'SUBMITTED' | 'CANCELLED';

/** 盘次范围类型：zone=按库区 / whole=off 档整仓 / unassigned=未归位桶 */
export type StocktakeScopeType = 'zone' | 'whole' | 'unassigned';

/**
 * 盘次：同一时刻只有一个负责人（独占锁），可指派也可开放认领（规格 §3.6）。
 */
@Entity()
@Index(['taskId'])
@Index(['tenantChannelId', 'assigneeId'])
export class StocktakeWave extends VendureEntity {
    constructor(input?: DeepPartial<StocktakeWave>) {
        super(input);
    }

    @Column({ type: 'varchar' })
    tenantChannelId!: string;

    @Column({ type: 'int' })
    taskId!: number;

    @Column({ type: 'varchar' })
    scopeType!: StocktakeScopeType;

    @Column({ type: 'int', nullable: true })
    zoneId!: number | null;

    /** 冗余快照：库区改名后仍可对账 */
    @Column({ type: 'varchar', nullable: true })
    zoneCode!: string | null;

    @Column({ type: 'varchar', nullable: true })
    zoneName!: string | null;

    /** TenantMember.id；null = 待认领 */
    @Column({ type: 'varchar', nullable: true })
    assigneeId!: string | null;

    @Column({ type: 'varchar', nullable: true })
    assigneeName!: string | null;

    @Column({ type: 'varchar' })
    state!: StocktakeWaveState;

    /** 快照：应盘项数（进度分母） */
    @Column({ type: 'int', default: 0 })
    expectedCount!: number;

    /** 已盘项数（冗余加速） */
    @Column({ type: 'int', default: 0 })
    countedCount!: number;

    @Column({ type: 'timestamptz', nullable: true })
    claimedAt!: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    submittedAt!: Date | null;
}