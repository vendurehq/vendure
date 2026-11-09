import { OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
/** 韩国 PG 异步回调入参（字段名即对外契约，真实 PG 接入时在 controller 做映射） */
export interface KoreaPgCallbackPayload {
    orderCode: string;
    transactionId: string;
    status: 'paid' | 'failed';
    amount?: number;
    currencyCode?: string;
    idempotencyKey?: string;
}
export interface KoreaPgCallbackResult {
    success: boolean;
    duplicate: boolean;
    code: string | null;
    orderCode: string;
}
/** paid 节点幂等键：调用方显式传入优先，否则按渠道+订单号派生（CT-05 重复回调口径） */
export declare function paidIdempotencyKey(channelToken: string, orderCode: string, override?: string | null): string;
/**
 * 韩国 PG 回调处理（CT-05 一期桩）。
 * 幂等口径：同一订单的 paid 节点只写一次，幂等键优先取入参 idempotencyKey，
 * 否则用 `payment:{channelToken}:{orderCode}:paid`；重复回调返回成功 +
 * PAYMENT_CALLBACK_DUPLICATE，并写一条结构化审计日志（一期不新建审计表）。
 */
export declare class OnebridgePaymentCallbackService {
    private connection;
    private orderService;
    constructor(connection: TransactionalConnection, orderService: OrderService);
    handleKoreaPg(ctx: RequestContext, payload: KoreaPgCallbackPayload): Promise<KoreaPgCallbackResult>;
    /** 结算该订单下仍处于 Authorized 的 korea-pg 支付；无支付记录时保持时间轴落账（桩期口径） */
    private settleAuthorizedPayments;
    /** net 线付款完成后 wait_pay → shipping（demo/data.js 阶段流转）；其他业务线不动阶段 */
    private advanceStage;
    private auditDuplicate;
}
