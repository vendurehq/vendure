import { Injectable } from '@nestjs/common';
import {
    ID,
    OrderService,
    Refund,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import type { CodAuthorization, CodAuthorizationInput, CodRefundCreateInput } from '@vendure/cjk-plugin';
import { CampusCodReceipt, CampusCodRefundLink } from './cod-receipt.entities';

interface ReceiptRow {
    id: number;
    amount: number;
    status: string;
}

/**
 * COD 退款闸门：唯一政策 = COD 退款只认 confirmed 收款记录。
 * - 无收款记录：不建退款单（未收款直接取消；已收款待退走人工现金工单）。
 * - 有收款记录：可退上限 = 实收金额 − 已挂非 Failed 退款；建单即 Settled（现金已退），并写退款关联。
 * - 事务内 SELECT ... FOR UPDATE 锁收款行，防并发重复退。
 */
@Injectable()
export class CodRefundPolicyService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
    ) {}

    private async findConfirmedReceipt(
        ctx: RequestContext,
        paymentId: ID | number,
        lock: boolean,
    ): Promise<ReceiptRow | null> {
        const qb = this.connection
            .getRepository(ctx, CampusCodReceipt)
            .createQueryBuilder('r')
            .where('r.paymentId = :paymentId', { paymentId })
            .andWhere('r.status = :status', { status: 'confirmed' });
        if (lock) {
            qb.setLock('pessimistic_write');
        }
        const row = await qb.getOne();
        if (!row) return null;
        return { id: row.id as number, amount: row.amount, status: row.status };
    }

    /** 已挂在收款上的非 Failed 退款金额合计（分） */
    private async usedAmount(ctx: RequestContext, receiptId: number): Promise<number> {
        const rows = await this.connection.rawConnection.manager.query(
            `SELECT COALESCE(SUM(l."amountApplied"), 0)::int AS used
             FROM campus_cod_refund_link l
             JOIN "refund" r ON r.id = l."refundId"
             WHERE l."receiptId" = $1 AND r.state <> 'Failed'`,
            [receiptId],
        );
        return Number(rows?.[0]?.used ?? 0);
    }

    async hasConfirmedReceipt(ctx: RequestContext, paymentId: ID | number): Promise<boolean> {
        return (await this.findConfirmedReceipt(ctx, paymentId, false)) != null;
    }

    /** handler 内校验（无收款/超额即抛错，核心不落退款行） */
    async authorize(ctx: RequestContext, input: CodAuthorizationInput): Promise<CodAuthorization> {
        const receipt = await this.findConfirmedReceipt(ctx, input.payment.id, false);
        if (!receipt) {
            throw new UserInputError(
                '该 COD 支付没有收款记录，不能创建退款单；未收款订单请直接取消，已收款待退请走人工现金工单',
            );
        }
        const amount = Math.round(Number(input.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new UserInputError('退款金额必须为正整数（单位：分）');
        }
        const cap = receipt.amount - (await this.usedAmount(ctx, receipt.id));
        if (amount > cap) {
            throw new UserInputError(`退款金额 ${amount} 分超过未退实收余额 ${cap} 分`);
        }
        return {
            receiptId: receipt.id,
            transactionId: `COD-CASH-${receipt.id}`,
            metadata: { codReceiptId: receipt.id, amountApplied: amount },
        };
    }

    /** 统一修改退款入口：锁收款 → 校验额度 → refundOrder → 写退款关联 */
    async createRefund(ctx: RequestContext, input: CodRefundCreateInput): Promise<Refund | Error> {
        return this.connection.withTransaction(ctx, async txCtx => {
            const receipt = await this.findConfirmedReceipt(txCtx, input.paymentId, true);
            if (!receipt) {
                throw new UserInputError(
                    '该 COD 支付没有收款记录，不能创建退款单；未收款订单请直接取消，已收款待退请走人工现金工单',
                );
            }
            const amount = Math.round(Number(input.amount));
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new UserInputError('退款金额必须为正整数（单位：分）');
            }
            const cap = receipt.amount - (await this.usedAmount(txCtx, receipt.id));
            if (amount > cap) {
                throw new UserInputError(`退款金额 ${amount} 分超过未退实收余额 ${cap} 分`);
            }
            const result: any = await this.orderService.refundOrder(txCtx, {
                orderId: input.orderId,
                lines: input.lines ?? [],
                shipping: input.shipping ?? 0,
                adjustment: input.adjustment ?? 0,
                paymentId: input.paymentId,
                reason: input.reason,
                amount,
            } as any);
            if (result instanceof Error || result?.errorCode) {
                return result;
            }
            const refund: Refund = result;
            const linkRepo = this.connection.getRepository(txCtx, CampusCodRefundLink);
            await linkRepo.save(
                linkRepo.create({
                    refundId: refund.id as number,
                    receiptId: receipt.id,
                    orderId: Number(input.orderId),
                    paymentId: Number(input.paymentId),
                    amountApplied: amount,
                    currencyCode: 'CNY',
                    createdById: (ctx.activeUserId as number) ?? null,
                    note: input.reason,
                }),
            );
            return refund;
        });
    }

    /** 台账里该支付的可退余额（供后台/对账查询） */
    async refundableAmount(ctx: RequestContext, paymentId: ID | number): Promise<number> {
        const receipt = await this.findConfirmedReceipt(ctx, paymentId, false);
        if (!receipt) return 0;
        return receipt.amount - (await this.usedAmount(ctx, receipt.id));
    }
}
