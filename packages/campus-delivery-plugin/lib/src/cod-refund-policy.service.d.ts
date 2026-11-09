import { ID, OrderService, Refund, RequestContext, TransactionalConnection } from '@vendure/core';
import type { CodAuthorization, CodAuthorizationInput, CodRefundCreateInput } from '@vendure/cjk-plugin';
/**
 * COD 退款闸门：唯一政策 = COD 退款只认 confirmed 收款记录。
 * - 无收款记录：不建退款单（未收款直接取消；已收款待退走人工现金工单）。
 * - 有收款记录：可退上限 = 实收金额 − 已挂非 Failed 退款；建单即 Settled（现金已退），并写退款关联。
 * - 事务内 SELECT ... FOR UPDATE 锁收款行，防并发重复退。
 */
export declare class CodRefundPolicyService {
    private connection;
    private orderService;
    constructor(connection: TransactionalConnection, orderService: OrderService);
    private findConfirmedReceipt;
    /** 已挂在收款上的非 Failed 退款金额合计（分） */
    private usedAmount;
    hasConfirmedReceipt(ctx: RequestContext, paymentId: ID | number): Promise<boolean>;
    /** handler 内校验（无收款/超额即抛错，核心不落退款行） */
    authorize(ctx: RequestContext, input: CodAuthorizationInput): Promise<CodAuthorization>;
    /** 统一修改退款入口：锁收款 → 校验额度 → refundOrder → 写退款关联 */
    createRefund(ctx: RequestContext, input: CodRefundCreateInput): Promise<Refund | Error>;
    /** 台账里该支付的可退余额（供后台/对账查询） */
    refundableAmount(ctx: RequestContext, paymentId: ID | number): Promise<number>;
}
