import { Column, Entity, Index, Unique } from 'typeorm';
import { DeepPartial, VendureEntity } from '@vendure/core';

/**
 * 应盘行（规格 §4.3）。
 * 注意：`bookQty` 是「该变体在该仓」的账面快照，**仅供行内提示**，
 * 差异一律按变体汇总计算（R11），禁止逐行相减。
 * 唯一约束里 `binId` 可空 → postgres 中 NULL 互不相等，故「未归位桶」允许同变体多行（符合预期）。
 */
@Entity()
@Unique(['taskId', 'waveId', 'variantId', 'binId'])
@Index(['taskId', 'waveId'])
@Index(['waveId', 'countedQty'])
@Index(['taskId', 'variantId'])
export class StocktakeLine extends VendureEntity {
    constructor(input?: DeepPartial<StocktakeLine>) {
        super(input);
    }

    @Column({ type: 'varchar' })
    tenantChannelId!: string;

    @Column({ type: 'int' })
    taskId!: number;

    @Column({ type: 'int' })
    waveId!: number;

    @Column({ type: 'int' })
    variantId!: number;

    /** 快照：商品改名后仍可对账 */
    @Column({ type: 'varchar' })
    variantSku!: string;

    @Column({ type: 'varchar' })
    variantName!: string;

    @Column({ type: 'int', nullable: true })
    zoneId!: number | null;

    @Column({ type: 'int', nullable: true })
    binId!: number | null;

    @Column({ type: 'varchar', nullable: true })
    zoneCode!: string | null;

    @Column({ type: 'varchar', nullable: true })
    binCode!: string | null;

    @Column({ type: 'int', default: 0 })
    bookQty!: number;

    /** 实盘数；null = 未盘 */
    @Column({ type: 'int', nullable: true })
    countedQty!: number | null;

    /** 盘盈行（清单外登记的） */
    @Column({ type: 'boolean', default: false })
    isExtra!: boolean;

    @Column({ type: 'varchar', nullable: true })
    countedById!: string | null;

    @Column({ type: 'varchar', nullable: true })
    countedByName!: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    countedAt!: Date | null;

    @Column({ type: 'text', nullable: true })
    note!: string | null;
}