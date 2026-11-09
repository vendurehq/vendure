import { ID, Order, Payment, Refund, RequestContext } from '@vendure/core';

export interface CodAuthorizationInput {
    order: Order;
    payment: Payment;
    /** 本次针对该支付要退的金额（分） */
    amount: number;
}

export interface CodAuthorization {
    receiptId: number;
    transactionId: string;
    metadata: Record<string, any>;
}

export interface CodRefundCreateInput {
    orderId: ID;
    paymentId: ID;
    amount: number;
    reason: string;
    lines?: Array<{ orderLineId: ID; quantity: number }>;
    shipping?: number;
    adjustment?: number;
}

/**
 * COD 退款闸门端口（由 campus-delivery-plugin 注册）。
 * 唯一政策：COD 退款只认 confirmed 收款记录；无收款记录不建退款单。
 * 未注册时 COD handler 一律 fail-closed（拒绝创建任何 COD 退款单）。
 */
export interface CodRefundPolicyPort {
    /** 支付上是否已有 confirmed 收款（能力判定用，不建单） */
    hasConfirmedReceipt(ctx: RequestContext, paymentId: ID | number): Promise<boolean>;
    /** handler 内校验：无收款 / 超额则抛错（核心在调用 handler 后才落退款行，抛错即不落行） */
    authorize(ctx: RequestContext, input: CodAuthorizationInput): Promise<CodAuthorization>;
    /** 统一建退款入口：锁收款 → 校验额度 → refundOrder → 写退款关联 */
    createRefund(ctx: RequestContext, input: CodRefundCreateInput): Promise<Refund | Error>;
}

let port: CodRefundPolicyPort | null = null;

export function setCodRefundPolicyPort(p: CodRefundPolicyPort | null): void {
    port = p;
}

export function getCodRefundPolicyPort(): CodRefundPolicyPort | null {
    return port;
}
