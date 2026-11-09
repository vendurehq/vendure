import { Injectable } from '@nestjs/common';
import {
    Logger,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { StageEvent } from '../entities';
import { Errors } from '../errors';
import { timelineNodeCopy } from '../i18n';
import { loggerCtx, ONEBRIDGE_ERROR_CODES } from '../types';

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
export function paidIdempotencyKey(channelToken: string, orderCode: string, override?: string | null): string {
    const explicit = override?.trim();
    return explicit || `payment:${channelToken}:${orderCode}:paid`;
}

/**
 * 韩国 PG 回调处理（CT-05 一期桩）。
 * 幂等口径：同一订单的 paid 节点只写一次，幂等键优先取入参 idempotencyKey，
 * 否则用 `payment:{channelToken}:{orderCode}:paid`；重复回调返回成功 +
 * PAYMENT_CALLBACK_DUPLICATE，并写一条结构化审计日志（一期不新建审计表）。
 */
@Injectable()
export class OnebridgePaymentCallbackService {
    constructor(
        private connection: TransactionalConnection,
        private orderService: OrderService,
    ) {}

    async handleKoreaPg(ctx: RequestContext, payload: KoreaPgCallbackPayload): Promise<KoreaPgCallbackResult> {
        const orderCode = payload.orderCode?.trim();
        if (!orderCode) throw new UserInputError('orderCode is required');
        if (!payload.transactionId?.trim()) throw new UserInputError('transactionId is required');
        if (payload.status !== 'paid') {
            throw new UserInputError(`Unsupported callback status: ${payload.status}（一期仅处理 paid）`);
        }

        const order = await this.orderService.findOneByCode(ctx, orderCode, ['payments']);
        if (!order) throw Errors.orderNotFound(orderCode);

        if (payload.currencyCode && payload.currencyCode !== order.currencyCode) {
            throw Errors.currencyMismatch(order.currencyCode, payload.currencyCode);
        }
        if (payload.amount != null && payload.amount !== order.totalWithTax) {
            throw new UserInputError(
                `Amount mismatch for ${orderCode}: order ${order.totalWithTax}, callback ${payload.amount}`,
            );
        }

        const stageRepo = this.connection.getRepository(ctx, StageEvent);
        const idempotencyKey = paidIdempotencyKey(ctx.channel.token, orderCode, payload.idempotencyKey);
        const paidNode = await stageRepo.findOne({
            where: [
                { idempotencyKey },
                { ownerType: 'order', ownerCode: orderCode, stage: 'wait_pay' },
            ],
        });
        if (paidNode) {
            this.auditDuplicate(ctx, orderCode, payload, idempotencyKey);
            return {
                success: true,
                duplicate: true,
                code: ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_DUPLICATE,
                orderCode,
            };
        }

        await this.settleAuthorizedPayments(ctx, order);

        const copy = timelineNodeCopy('net', 1, 'zh');
        await stageRepo.save(
            new StageEvent({
                ownerType: 'order',
                ownerCode: orderCode,
                // 14 态冻结、无 paid 态：支付完成对应 net 时间轴 index 1，与 wait_pay 的 stageIndex 对齐
                stage: 'wait_pay',
                // TODO(韩文待定稿)：韩文缺失，按约定回落中文占位
                titleKr: copy.title,
                titleCn: copy.title,
                descKr: null,
                descCn: copy.desc,
                state: 'done',
                occurredAt: new Date(),
                operator: 'korea-pg-callback',
                idempotencyKey,
            }),
        );

        await this.advanceStage(ctx, orderCode);
        Logger.info(
            `korea-pg callback paid: order=${orderCode} transaction=${payload.transactionId} channel=${ctx.channel.token}`,
            loggerCtx,
        );
        return { success: true, duplicate: false, code: null, orderCode };
    }

    /** 结算该订单下仍处于 Authorized 的 korea-pg 支付；无支付记录时保持时间轴落账（桩期口径） */
    private async settleAuthorizedPayments(ctx: RequestContext, order: Order): Promise<void> {
        const payments = ((order as any).payments ?? []) as Array<{ id: any; state: string; method: string }>;
        for (const payment of payments) {
            if (payment.state === 'Authorized' && payment.method === 'korea-pg') {
                await this.orderService.settlePayment(ctx, payment.id);
            }
        }
    }

    /** net 线付款完成后 wait_pay → shipping（demo/data.js 阶段流转）；其他业务线不动阶段 */
    private async advanceStage(ctx: RequestContext, orderCode: string): Promise<void> {
        const order = await this.orderService.findOneByCode(ctx, orderCode);
        if (!order) return;
        const customFields = order.customFields as Record<string, unknown>;
        if (customFields.crossBorderStage !== 'wait_pay') return;
        customFields.crossBorderStage = 'shipping';
        await this.connection.getRepository(ctx, Order).save(order);
    }

    private auditDuplicate(
        ctx: RequestContext,
        orderCode: string,
        payload: KoreaPgCallbackPayload,
        idempotencyKey: string,
    ): void {
        Logger.warn(
            `${ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_DUPLICATE} ${JSON.stringify({
                orderCode,
                transactionId: payload.transactionId,
                idempotencyKey,
                channelToken: ctx.channel.token,
            })}`,
            loggerCtx,
        );
    }
}
