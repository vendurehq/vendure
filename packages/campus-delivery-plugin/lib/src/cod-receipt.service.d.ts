import { ID, OrderService, Payment, RequestContext, TransactionalConnection } from '@vendure/core';
import { CampusCodReceipt } from './cod-receipt.entities';
export type CodCollectSource = 'delivery_confirm' | 'merchant_handover' | 'pickup_counter' | 'admin_manual';
export interface RegisterCodReceiptInput {
    /** 实收金额，单位：分（必填） */
    amount: number;
    paymentId?: ID | number | null;
    method?: string | null;
    collectedAt?: Date | string | null;
    collectedByRole: 'rider' | 'merchant' | 'admin';
    collectedById?: number | null;
    collectedByName?: string | null;
    source: CodCollectSource;
    deliveryOrderId?: number | null;
    handoverCode?: string | null;
    deliveryRecordId?: number | null;
    voucherNo?: string | null;
    images?: string[] | null;
    note?: string | null;
    idempotencyKey?: string | null;
}
/**
 * COD 现金收款台账服务。
 *
 * 原则：先有收款记录，才能记载退款记录。骑手送达 / 商家柜台确认收款时登记一笔
 * confirmed 收款，同时把对应的 COD 授权支付置为 Settled；退款侧（阶段 3）只认 confirmed 收款。
 */
export declare class CodCollectionService {
    private connection;
    private orderService;
    constructor(connection: TransactionalConnection, orderService: OrderService);
    /** 本单 COD 支付（方法 code = cash-on-delivery） */
    codPayments(ctx: RequestContext, orderId: ID | number): Promise<Payment[]>;
    /** 是否还有待收 COD 支付（骑手送达前用于「实收金额必填」判定） */
    requiresCash(ctx: RequestContext, orderId: ID | number): Promise<boolean>;
    /**
     * 登记一笔 COD 收款并结算对应支付。
     * 幂等：同一支付 + 同一环节 + 同一幂等键重复提交返回原记录；已有 confirmed 收款但幂等键不同则拒绝。
     */
    register(ctx: RequestContext, orderId: ID | number, input: RegisterCodReceiptInput): Promise<CampusCodReceipt>;
    /** 结算 COD 授权支付（失败只告警，不删除已落的收款记录） */
    private settleCodPayment;
    /** 作废收款记录（主管权限）：已关联退款单的不得作废；作废仅纠错台账，不回退已结算支付 */
    voidReceipt(ctx: RequestContext, receiptId: ID | number, reason: string): Promise<CampusCodReceipt>;
    /** 收款台账查询：按订单或全量（最多 200 条，倒序） */
    list(ctx: RequestContext, orderId?: ID | number | null): Promise<CampusCodReceipt[]>;
    /** 指定支付上是否已有 confirmed 收款（退款侧阶段 3 复用） */
    findConfirmedByPayment(ctx: RequestContext, paymentId: ID | number): Promise<CampusCodReceipt | null>;
}
