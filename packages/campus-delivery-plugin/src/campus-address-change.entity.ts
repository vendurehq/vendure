import { Column, Entity, Index } from 'typeorm';
import { DeepPartial, ID, VendureEntity } from '@vendure/core';

/**
 * 改址台账：顾客下单后修改配送地址产生的运费差额（多退少补）。
 * 差额不阻塞改址，运营在后台统一退款/补收后标记结清。
 */
@Entity()
// 与迁移显式索引同名声明：否则 schema 校验会把这些索引判为多余并打印 DROP INDEX 噪音
@Index('idx_campus_address_change_channel', ['channelId', 'status'])
@Index('idx_campus_address_change_order', ['orderId'])
export class CampusAddressChange extends VendureEntity {
    @Column('int') channelId: ID;
    @Column('int') orderId: ID;
    @Column() orderCode: string;
    @Column('int', { nullable: true }) customerId: ID | null;

    @Column() fromZone: string;
    @Column() fromBuilding: string;
    @Column({ type: 'varchar', nullable: true }) fromDetail: string | null;

    @Column() toZone: string;
    @Column() toBuilding: string;
    @Column({ type: 'varchar', nullable: true }) toDetail: string | null;

    @Column('int') oldFee: number; // 分
    @Column('int') newFee: number; // 分
    @Column('int') diff: number; // 正=待收（顾客欠），负=待退

    /** pending | settled | waived */
    @Column({ default: 'pending' }) status: string;
    @Column({ nullable: true, type: 'timestamptz' }) settledAt: Date | null;
    @Column('int', { nullable: true }) settledBy: ID | null;
    /** refund=已退顾客 | collect=已补收 | waive=免收 */
    @Column({ type: 'varchar', nullable: true }) settleAction: string | null;
    /** 结清凭证：补收的收款方式/流水号，退款/免收的说明（补收必填） */
    @Column({ type: 'varchar', nullable: true }) settleNote: string | null;
    /** 实际退款单 id（action=refund 且差额>0 时写入，便于财务对账） */
    @Column('int', { nullable: true }) refundId: ID | null;

    /** customer=顾客自助 | admin=运营代改 */
    @Column({ type: 'varchar', nullable: true }) source: string | null;
    /** 代改原因（运营代改必填，顾客自助可空） */
    @Column({ type: 'varchar', nullable: true }) reason: string | null;
    /** 发起改址的用户 id（顾客=本人，运营=管理员） */
    @Column('int', { nullable: true }) changedBy: ID | null;

    constructor(input?: DeepPartial<CampusAddressChange>) {
        super(input);
    }
}
