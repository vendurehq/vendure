import { Column, Entity, Index, Unique } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';

/** 任务状态（规格 §5）：DRAFT → OPEN → COUNTING → COUNTED → POSTED，任意非终态可 CANCELLED */
export type StocktakeTaskState = 'DRAFT' | 'OPEN' | 'COUNTING' | 'COUNTED' | 'POSTED' | 'CANCELLED';

/**
 * 盘库任务：一个任务 = 一个仓库；多仓协同靠 activityCode 分组，各仓独立过账（规格 §3.3）。
 */
@Entity()
@Unique(['tenantChannelId', 'code'])
@Index(['tenantChannelId', 'state'])
@Index(['tenantChannelId', 'activityCode'])
// 单据中心按 postedStockDocId 反查任务号（D44）：复合索引，避免单据列表每页全表扫
@Index(['tenantChannelId', 'postedStockDocId'])
export class StocktakeTask extends VendureEntity {
    constructor(input?: DeepPartial<StocktakeTask>) {
        super(input);
    }

    /** 任务号，前缀 TK（避开单据前缀 ST，防混淆） */
    @Column({ type: 'varchar' })
    code!: string;

    /** 渠道收口键（硬性 R10）：写入 String(ctx.channelId)，所有查询按此过滤 */
    @Column({ type: 'varchar' })
    tenantChannelId!: string;

    @Column({ type: 'int' })
    stockLocationId!: number;

    /** 盘点活动分组码（多仓归一组），可为空 */
    @Column({ type: 'varchar', nullable: true })
    activityCode!: string | null;

    @Column({ type: 'varchar' })
    name!: string;

    /** 圈范围条件快照（JSON 文本）：{ zones, categoryIds, variantIds, includeZeroBook } */
    @Column({ type: 'text' })
    scopeJson!: string;

    /** 建任务时的档位（off/zone/bin）：避免中途改档导致语义漂移 */
    @Column({ type: 'varchar' })
    binModeAtCreate!: string;

    @Column({ type: 'varchar' })
    state!: StocktakeTaskState;

    @Column({ type: 'varchar', nullable: true })
    createdById!: string | null;

    @Column({ type: 'varchar', nullable: true })
    createdByName!: string | null;

    @Column({ type: 'int', nullable: true })
    postedStockDocId!: number | null;

    @Column({ type: 'timestamptz', nullable: true })
    postedAt!: Date | null;

    @Column({ type: 'text', nullable: true })
    note!: string | null;
}