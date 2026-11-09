import { ID, Payment, Refund, RequestContext, TransactionalConnection, UserInputError } from '@vendure/core';
import { getCodRefundPolicyPort } from '@vendure/cjk-plugin';

/** 可退款支付状态：只认已成功支付（Declined/Error/Cancelled 的重试单不可退） */
export const REFUNDABLE_PAYMENT_STATES = ['Settled', 'Authorized'];

/** 退款失败终态：不计入已退总额，允许重试真实退款（否则重试会跳过退款直接取消订单） */
const REFUND_FAILED_STATE = 'Failed';

export interface RefundablePayment {
    payment: Payment;
    refunded: number;
    remaining: number;
}

/** 单支付单已退总额（排除 Failed：结算失败的单并未真实打款） */
export async function refundedTotal(connection: TransactionalConnection, paymentId: number | string): Promise<number> {
    const refunded = await connection.rawConnection
        .getRepository(Refund)
        .createQueryBuilder('r')
        .select('COALESCE(SUM(r.total), 0)', 'sum')
        .where('r."paymentId" = :pid', { pid: paymentId })
        .andWhere('r.state <> :failed', { failed: REFUND_FAILED_STATE })
        .getRawOne();
    return Number(refunded?.sum ?? 0);
}

/** 拆单/拒单等所有退款创建点的统一入口：COD 走收款闸门，其它支付方式保持原 refundOrder 路径。
 * COD 无收款记录时不建退款单（未收款无可退）；有收款则建单即 Settled 并写收款关联。 */
export async function createOrderRefund(
    orderService: { refundOrder: (ctx: RequestContext, input: any) => Promise<any> },
    ctx: RequestContext,
    input: {
        orderId: ID;
        paymentId: ID;
        amount: number;
        reason: string;
        paymentMethod?: string | null;
        shipping?: number;
        adjustment?: number;
        lines?: Array<{ orderLineId: ID; quantity: number }>;
    },
): Promise<any> {
    if (String(input.paymentMethod ?? '') === 'cash-on-delivery') {
        const policy = getCodRefundPolicyPort();
        if (!policy) {
            throw new UserInputError('COD 退款闸门不可用：无收款记录能力，拒绝创建退款单');
        }
        return policy.createRefund(ctx, {
            orderId: input.orderId,
            paymentId: input.paymentId,
            amount: input.amount,
            reason: input.reason,
            lines: input.lines,
        });
    }
    return orderService.refundOrder(ctx, {
        paymentId: input.paymentId,
        amount: input.amount,
        shipping: input.shipping ?? 0,
        adjustment: input.adjustment ?? 0,
        reason: input.reason,
        ...(input.lines ? { lines: input.lines } : {}),
    } as any);
}

/**
 * 结算退款：refundOrder 只创建 Pending 退款单，settleRefund 才真实打款。
 * 结算失败必须把退款单置 Failed（保留审计痕迹），否则该单仍计入已退总额：
 * 商家重试拒单/异常全额退款时会判定「无可退余额」，直接取消订单而不退款（客户静默少退）。
 */
export async function settleRefundOrMarkFailed(
    connection: TransactionalConnection,
    orderService: { settleRefund: (ctx: RequestContext, input: any) => Promise<unknown> },
    ctx: RequestContext,
    refundId: ID,
): Promise<void> {
    try {
        // 查 refund 关联的 paymentId，作为 transactionId 传入（Vendure SettleRefundInput 要求）
        const conn = connection.rawConnection;
        const repo = conn.getRepository(Refund);
        const refund = await repo.findOne({ where: { id: refundId } } as any);
        // COD 收款闸门建单即 Settled（现金已退），无需再打款；重复 settle 会把状态误置 Failed
        if (String((refund as any)?.state) === 'Settled') return;
        const transactionId = (refund as any)?.paymentId ?? String(refundId);
        await orderService.settleRefund(ctx, { id: refundId, transactionId });
    } catch (e) {
        await connection.rawConnection
            .getRepository(Refund)
            .update(refundId as any, { state: REFUND_FAILED_STATE } as any)
            .catch(() => undefined);
        throw e;
    }
}

/**
 * 订单可退支付单（新→旧）：仅 Settled/Authorized，且仍有未退余额。
 * 统一商家拒单 / T4 / 异常处置 / 改址退款的支付单选择口径，避免选中失败重试单导致退款失败。
 */
export async function refundablePayments(
    connection: TransactionalConnection,
    orderId: number | string,
): Promise<RefundablePayment[]> {
    const payments = await connection.rawConnection.getRepository(Payment).find({
        where: { order: { id: orderId } } as any,
        order: { id: 'DESC' } as any,
    });
    const out: RefundablePayment[] = [];
    for (const payment of payments) {
        if (!REFUNDABLE_PAYMENT_STATES.includes(String(payment.state))) continue;
        const refunded = await refundedTotal(connection, payment.id);
        const remaining = Number(payment.amount) - refunded;
        if (remaining > 0) out.push({ payment, refunded, remaining });
    }
    return out;
}

/** 选一张可退支付单：needAmount 为空取最新可退单；否则要求单张余额足够 */
export async function pickRefundablePayment(
    connection: TransactionalConnection,
    orderId: number | string,
    needAmount?: number,
): Promise<RefundablePayment | null> {
    const list = await refundablePayments(connection, orderId);
    if (needAmount == null) return list[0] ?? null;
    return list.find(p => p.remaining >= needAmount) ?? null;
}
