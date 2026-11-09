import { DeepPartial, ID, VendureEntity } from '@vendure/core';
/**
 * 货到付款（COD）现金收款记录。
 * 原则：先有收款记录，才能记载退款记录。退款必须挂在一笔真实可追溯的收款上。
 * 同一笔 payment 只允许存在一条 confirmed 收款（见迁移里的部分唯一索引）。
 */
export declare class CampusCodReceipt extends VendureEntity {
    [key: string]: any;
    channelId: ID;
    orderId: number | null;
    orderCode: string | null;
    /** Vendure payment 主键 */
    paymentId: number;
    /** 实收金额，单位：分（必填） */
    amount: number;
    currencyCode: string;
    /** cash / wechat / alipay / other */
    method: string;
    /** 实际收款时点（不允许伪造，必填） */
    collectedAt: Date;
    /** rider / merchant / admin */
    collectedByRole: string;
    collectedById: number | null;
    collectedByName: string | null;
    /** delivery_confirm / merchant_handover / pickup_counter / admin_manual */
    source: string;
    /** 关联配送单（配送单确认送达时写入） */
    deliveryOrderId: number | null;
    /** 交接码/取餐码（有则记录，便于核对） */
    handoverCode: string | null;
    /** 关联配送记录（第三方配送或骑手任务记录） */
    deliveryRecordId: number | null;
    /** 凭证号：后台人工补录时必填 */
    voucherNo: string | null;
    /** 收款凭证照片（选填） */
    images: string[] | null;
    note: string | null;
    /** confirmed / voided */
    status: string;
    voidedAt: Date | null;
    voidedById: number | null;
    voidedByName: string | null;
    voidReason: string | null;
    /** 幂等键：同一支付/同一环节重复提交只落一条 */
    idempotencyKey: string | null;
    constructor(input?: DeepPartial<CampusCodReceipt>);
}
/**
 * 退款单 ↔ 收款记录 的强制关联。
 * 每笔退款单只能挂一条关联（refundId 唯一），amountApplied 记录本次冲减的实收金额（分）。
 */
export declare class CampusCodRefundLink extends VendureEntity {
    [key: string]: any;
    /** Vendure refund 主键（唯一） */
    refundId: number;
    receiptId: number;
    orderId: number | null;
    paymentId: number;
    /** 本次退款冲减的实收金额，单位：分 */
    amountApplied: number;
    currencyCode: string;
    createdById: number | null;
    createdByName: string | null;
    note: string | null;
    constructor(input?: DeepPartial<CampusCodRefundLink>);
}
