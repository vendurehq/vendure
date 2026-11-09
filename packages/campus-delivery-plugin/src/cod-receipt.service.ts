import { Injectable } from '@nestjs/common';
import {
    ID,
    Logger,
    OrderService,
    Payment,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { CampusCodReceipt, CampusCodRefundLink } from './cod-receipt.entities';

const COD_PAYMENT_CODE = 'cash-on-delivery';
const loggerCtx = 'CodCollection';

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
@Injectable()
export class CodCollectionService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
    ) {}

    /** 本单 COD 支付（方法 code = cash-on-delivery） */
    async codPayments(ctx: RequestContext, orderId: ID | number): Promise<Payment[]> {
        return this.connection
            .getRepository(ctx, Payment)
            .createQueryBuilder('p')
            .innerJoin('p.order', 'o')
            .where('o.id = :orderId', { orderId })
            .getMany();
    }

    /** 是否还有待收 COD 支付（骑手送达前用于「实收金额必填」判定） */
    async requiresCash(ctx: RequestContext, orderId: ID | number): Promise<boolean> {
        const payments = await this.codPayments(ctx, orderId);
        return payments.some(p => p.state === 'Authorized');
    }

    /**
     * 登记一笔 COD 收款并结算对应支付。
     * 幂等：同一支付 + 同一环节 + 同一幂等键重复提交返回原记录；已有 confirmed 收款但幂等键不同则拒绝。
     */
    async register(
        ctx: RequestContext,
        orderId: ID | number,
        input: RegisterCodReceiptInput,
    ): Promise<CampusCodReceipt> {
        const amount = Math.round(Number(input.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new UserInputError('收款金额必填且必须为正整数（单位：分）');
        }
        if (!input.source) {
            throw new UserInputError('收款来源必填');
        }
        if (input.source === 'admin_manual' && !String(input.voucherNo ?? '').trim()) {
            throw new UserInputError('后台人工补录必须填写凭证号');
        }
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new UserInputError('订单不存在');
        }
        const cod = (await this.codPayments(ctx, orderId)).filter(p => p.method === COD_PAYMENT_CODE);
        if (!cod.length) {
            throw new UserInputError('该订单不是货到付款（COD）订单');
        }

        const repo = this.connection.getRepository(ctx, CampusCodReceipt);
        let target: Payment | undefined;
        if (input.paymentId != null) {
            target = cod.find(p => Number(p.id) === Number(input.paymentId));
            if (!target) {
                throw new UserInputError('指定的支付不是本单 COD 支付');
            }
        } else {
            const authorized = cod.filter(p => p.state === 'Authorized');
            if (authorized.length === 1) {
                target = authorized[0];
            } else if (authorized.length > 1) {
                throw new UserInputError('本单存在多笔待收 COD 支付，请指定 paymentId 逐笔确认');
            } else {
                // 没有待收支付：已有 confirmed 收款则幂等返回，否则转人工核对
                const existing = await repo.findOne({
                    where: { paymentId: cod[0].id as number, status: 'confirmed' },
                });
                if (existing) return existing;
                throw new UserInputError('本单暂无待收 COD 支付（可能已结算），请核对后走后台补录');
            }
        }

        const idempotencyKey =
            String(input.idempotencyKey ?? '').trim() || `cod:${target.id}:${input.source}`;

        const existingForPayment = await repo.findOne({
            where: { paymentId: target.id as number, status: 'confirmed' },
        });
        if (existingForPayment) {
            if (existingForPayment.idempotencyKey === idempotencyKey) {
                return existingForPayment; // 重复提交，幂等返回
            }
            throw new UserInputError('该支付已有 confirmed 收款记录，如需更正请由主管作废后重新登记');
        }

        const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
        if (Number.isNaN(collectedAt.getTime())) {
            throw new UserInputError('收款时点不合法');
        }
        const entity = repo.create({
            channelId: ctx.channelId,
            orderId: order.id as number,
            orderCode: order.code ?? null,
            paymentId: target.id as number,
            amount,
            currencyCode: 'CNY',
            method: String(input.method ?? 'cash'),
            collectedAt,
            collectedByRole: input.collectedByRole,
            collectedById: input.collectedById ?? null,
            collectedByName: input.collectedByName ?? null,
            source: input.source,
            deliveryOrderId: input.deliveryOrderId ?? null,
            handoverCode: input.handoverCode ?? null,
            deliveryRecordId: input.deliveryRecordId ?? null,
            voucherNo: input.voucherNo ?? null,
            images: input.images ?? null,
            note: input.note ?? null,
            status: 'confirmed',
            idempotencyKey,
        });
        let saved: CampusCodReceipt;
        try {
            saved = await repo.save(entity);
        } catch (e: any) {
            // 唯一索引并发兜底：另一路已插入则按幂等语义返回
            if (e?.code === '23505' || e?.driverError?.code === '23505') {
                const raced = await repo.findOne({
                    where: { paymentId: target.id as number, status: 'confirmed' },
                });
                if (raced) return raced;
            }
            throw e;
        }

        // 收款已真实发生：先落台账，再结算支付。结算失败不回滚收款记录（钱已收），留痕待补偿。
        await this.settleCodPayment(ctx, target, saved);
        return saved;
    }

    /** 结算 COD 授权支付（失败只告警，不删除已落的收款记录） */
    private async settleCodPayment(
        ctx: RequestContext,
        payment: Payment,
        receipt: CampusCodReceipt,
    ): Promise<void> {
        if (payment.state === 'Settled') return;
        try {
            const result: any = await this.orderService.settlePayment(ctx, payment.id);
            if (result?.errorCode || result?.state !== 'Settled') {
                Logger.warn(
                    `COD 收款 ${receipt.id} 已落库，但支付 ${payment.id} 结算失败：${result?.message ?? result?.state ?? 'unknown'}`,
                    loggerCtx,
                );
            }
        } catch (e: any) {
            Logger.error(
                `COD 收款 ${receipt.id} 已落库，但支付 ${payment.id} 结算异常（需人工核对）：${e?.message ?? e}`,
                loggerCtx,
            );
        }
    }

    /** 作废收款记录（主管权限）：已关联退款单的不得作废；作废仅纠错台账，不回退已结算支付 */
    async voidReceipt(
        ctx: RequestContext,
        receiptId: ID | number,
        reason: string,
    ): Promise<CampusCodReceipt> {
        if (!String(reason ?? '').trim()) {
            throw new UserInputError('作废理由必填');
        }
        const repo = this.connection.getRepository(ctx, CampusCodReceipt);
        const receipt = await repo.findOne({ where: { id: receiptId as number } });
        if (!receipt) {
            throw new UserInputError('收款记录不存在');
        }
        if (receipt.status !== 'confirmed') {
            throw new UserInputError('该收款记录已作废');
        }
        const linked = await this.connection
            .getRepository(ctx, CampusCodRefundLink)
            .count({ where: { receiptId: receipt.id as number } });
        if (linked > 0) {
            throw new UserInputError('该收款记录已关联退款单，不能作废');
        }
        receipt.status = 'voided';
        receipt.voidedAt = new Date();
        receipt.voidedById = (ctx.activeUserId as number) ?? null;
        receipt.voidedByName = null;
        receipt.voidReason = String(reason).trim();
        return repo.save(receipt);
    }

    /** 收款台账查询：按订单或全量（最多 200 条，倒序） */
    async list(ctx: RequestContext, orderId?: ID | number | null): Promise<CampusCodReceipt[]> {
        const qb = this.connection
            .getRepository(ctx, CampusCodReceipt)
            .createQueryBuilder('r')
            .orderBy('r.collectedAt', 'DESC')
            .take(200);
        if (orderId != null) {
            qb.andWhere('r.orderId = :orderId', { orderId });
        }
        return qb.getMany();
    }

    /** 指定支付上是否已有 confirmed 收款（退款侧阶段 3 复用） */
    async findConfirmedByPayment(
        ctx: RequestContext,
        paymentId: ID | number,
    ): Promise<CampusCodReceipt | null> {
        return this.connection
            .getRepository(ctx, CampusCodReceipt)
            .findOne({ where: { paymentId: paymentId as number, status: 'confirmed' } });
    }
}
