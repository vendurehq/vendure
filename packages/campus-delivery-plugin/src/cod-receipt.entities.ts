import { Column, Entity, Index } from 'typeorm';
import { DeepPartial, ID, VendureEntity } from '@vendure/core';

/**
 * 货到付款（COD）现金收款记录。
 * 原则：先有收款记录，才能记载退款记录。退款必须挂在一笔真实可追溯的收款上。
 * 同一笔 payment 只允许存在一条 confirmed 收款（见迁移里的部分唯一索引）。
 */
@Entity()
@Index('idx_campus_cod_receipt_channel', ['channelId', 'status'])
@Index('idx_campus_cod_receipt_order', ['orderId'])
@Index('idx_campus_cod_receipt_payment', ['paymentId'])
export class CampusCodReceipt extends VendureEntity {
    [key: string]: any;
    @Column('int') channelId: ID;
    @Column({ type: 'int', nullable: true }) orderId: number | null;
    @Column({ type: 'varchar', nullable: true }) orderCode: string | null;
    /** Vendure payment 主键 */
    @Column('int') paymentId: number;
    /** 实收金额，单位：分（必填） */
    @Column('int') amount: number;
    @Column({ type: 'varchar', default: 'CNY' }) currencyCode: string;
    /** cash / wechat / alipay / other */
    @Column({ type: 'varchar', default: 'cash' }) method: string;
    /** 实际收款时点（不允许伪造，必填） */
    @Column({ type: 'timestamptz' }) collectedAt: Date;
    /** rider / merchant / admin */
    @Column('varchar') collectedByRole: string;
    @Column({ type: 'int', nullable: true }) collectedById: number | null;
    @Column({ type: 'varchar', nullable: true }) collectedByName: string | null;
    /** delivery_confirm / merchant_handover / pickup_counter / admin_manual */
    @Column('varchar') source: string;
    /** 关联配送单（配送单确认送达时写入） */
    @Column({ type: 'int', nullable: true }) deliveryOrderId: number | null;
    /** 交接码/取餐码（有则记录，便于核对） */
    @Column({ type: 'varchar', nullable: true }) handoverCode: string | null;
    /** 关联配送记录（第三方配送或骑手任务记录） */
    @Column({ type: 'int', nullable: true }) deliveryRecordId: number | null;
    /** 凭证号：后台人工补录时必填 */
    @Column({ type: 'varchar', nullable: true }) voucherNo: string | null;
    /** 收款凭证照片（选填） */
    @Column({ type: 'simple-array', nullable: true }) images: string[] | null;
    @Column({ type: 'text', nullable: true }) note: string | null;
    /** confirmed / voided */
    @Column({ type: 'varchar', default: 'confirmed' }) status: string;
    @Column({ type: 'timestamptz', nullable: true }) voidedAt: Date | null;
    @Column({ type: 'int', nullable: true }) voidedById: number | null;
    @Column({ type: 'varchar', nullable: true }) voidedByName: string | null;
    @Column({ type: 'text', nullable: true }) voidReason: string | null;
    /** 幂等键：同一支付/同一环节重复提交只落一条 */
    @Column({ type: 'varchar', nullable: true }) idempotencyKey: string | null;
    constructor(input?: DeepPartial<CampusCodReceipt>) {
        super(input);
    }
}

/**
 * 退款单 ↔ 收款记录 的强制关联。
 * 每笔退款单只能挂一条关联（refundId 唯一），amountApplied 记录本次冲减的实收金额（分）。
 */
@Entity()
@Index('idx_campus_cod_refund_link_receipt', ['receiptId'])
@Index('idx_campus_cod_refund_link_order', ['orderId'])
export class CampusCodRefundLink extends VendureEntity {
    [key: string]: any;
    /** Vendure refund 主键（唯一） */
    @Column('int') refundId: number;
    @Column('int') receiptId: number;
    @Column({ type: 'int', nullable: true }) orderId: number | null;
    @Column('int') paymentId: number;
    /** 本次退款冲减的实收金额，单位：分 */
    @Column('int') amountApplied: number;
    @Column({ type: 'varchar', default: 'CNY' }) currencyCode: string;
    @Column({ type: 'int', nullable: true }) createdById: number | null;
    @Column({ type: 'varchar', nullable: true }) createdByName: string | null;
    @Column({ type: 'text', nullable: true }) note: string | null;
    constructor(input?: DeepPartial<CampusCodRefundLink>) {
        super(input);
    }
}
