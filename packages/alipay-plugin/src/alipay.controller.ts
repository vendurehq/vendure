import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger, Order, OrderService, Payment, ChannelService, RequestContext, TransactionalConnection, isGraphQlErrorResult } from '@vendure/core';
import { getPaymentOverride } from '@vendure/cjk-plugin/lib/src/payment/payment-config';
import type { AlipayCredentials } from '@vendure/cjk-plugin/lib/src/payment/payment-config.types';

import { ALIPAY_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { AlipayPluginOptions } from './types';
import { AlipaySdk } from 'alipay-sdk';

@Controller('alipay')
export class AlipayController {
    constructor(
        @Inject(ALIPAY_PLUGIN_OPTIONS) private options: AlipayPluginOptions,
        private orderService: OrderService,
        private channelService: ChannelService,
        private connection: TransactionalConnection,
    ) {}

    /** 全局按单号取单并切到订单所属渠道（回调域名/默认渠道未必是下单渠道） */
    private async resolveOrder(outTradeNo: string): Promise<{ order: Order; orderCtx: RequestContext }> {
        const channel = await this.channelService.getDefaultChannel();
        const baseCtx = new RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
        const base = await this.connection.getRepository(baseCtx, Order).findOne({
            where: { code: outTradeNo },
            relations: ['channels'],
        });
        if (!base) {
            Logger.error(`Alipay settle: order ${outTradeNo} not found (any channel)`, loggerCtx);
            throw new Error(`order ${outTradeNo} not found`);
        }
        const orderChannel =
            base.channels?.find(c => Number(c.id) === Number(baseCtx.channelId)) ?? base.channels?.[0];
        const orderCtx =
            orderChannel && Number(orderChannel.id) !== Number(baseCtx.channelId)
                ? new RequestContext({
                      apiType: 'admin',
                      channel: orderChannel,
                      isAuthorized: true,
                      authorizedAsOwnerOnly: false,
                  })
                : baseCtx;
        const order = await this.orderService.findOneByCode(orderCtx, outTradeNo, ['payments']);
        if (!order) {
            Logger.error(
                `Alipay settle: order ${outTradeNo} not found in channel ${orderCtx.channelId}`,
                loggerCtx,
            );
            throw new Error(`order ${outTradeNo} not found in channel ${orderCtx.channelId}`);
        }
        return { order, orderCtx };
    }

    /**
     * 回调内容校验：app_id / seller_id 必须与订单所属渠道（或插件）配置一致，
     * 金额必须等于某笔待结算支付的金额；任一不符即拒绝（返回 failure）。
     */
    private assertNotifyMatchesOrder(
        orderCtx: RequestContext,
        order: Order,
        body: any,
    ): void {
        const override = getPaymentOverride(orderCtx, 'alipay') as AlipayCredentials | null;
        const expectedAppId = override?.appId || this.options.auth?.appId;
        const expectedSellerId = override?.sellerId || this.options.sellerId;
        const outTradeNo = String(body.out_trade_no);

        if (expectedAppId && body.app_id !== expectedAppId) {
            throw new Error(
                `app_id mismatch for ${outTradeNo}: notify=${String(body.app_id)}, expected=${expectedAppId}`,
            );
        }
        if (expectedSellerId) {
            if (body.seller_id !== expectedSellerId) {
                throw new Error(
                    `seller_id mismatch for ${outTradeNo}: notify=${String(body.seller_id)}, expected=${expectedSellerId}`,
                );
            }
        } else if (!this.warnedMissingSellerId) {
            // 未配置 sellerId 时无法校验收款方，记录一次告警（不阻断，兼容存量配置）
            this.warnedMissingSellerId = true;
            Logger.warn(
                'ALIPAY_SELLER_ID 未配置，跳过 seller_id 校验；建议在插件选项或渠道 alipayJson 中补充',
                loggerCtx,
            );
        }

        const authorized = (order.payments || []).filter(p => p.state === 'Authorized');
        // 仅在有待结算支付时校验金额：已全部 Settled 的重复通知应幂等跳过
        if (authorized.length > 0) {
            const notifyCents = Math.round(Number(body.total_amount) * 100);
            if (!Number.isFinite(notifyCents)) {
                throw new Error(`missing total_amount in alipay notify for ${outTradeNo}`);
            }
            if (!authorized.some(p => Number(p.amount) === notifyCents)) {
                const amounts = authorized.map(p => `${p.id}:${p.amount}`).join(', ');
                throw new Error(
                    `amount mismatch for ${outTradeNo}: notify=${notifyCents}, authorized=[${amounts}]`,
                );
            }
        }
    }

    /**
     * 结算订单支付。失败必须抛错（外层返回 failure）触发支付宝重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，重复通知天然幂等。
     */
    private async settleOrderPayment(orderCtx: RequestContext, order: Order): Promise<void> {
        const outTradeNo = order.code;
        let settledCount = 0;
        for (const payment of order.payments || []) {
            // 幂等：已 Settled / 已取消等非 Authorized 状态直接跳过
            if (payment.state !== 'Authorized') continue;
            const result = await this.orderService.settlePayment(orderCtx, payment.id);
            if (isGraphQlErrorResult(result)) {
                // 并发重复通知：另一路已抢先结算成功时重查状态，已 Settled 视为幂等成功
                const fresh = await this.connection
                    .getRepository(orderCtx, Payment)
                    .findOne({ where: { id: payment.id } });
                if (fresh?.state === 'Settled') {
                    Logger.info(
                        `Payment ${payment.id} already settled by concurrent notify, skip (outTradeNo=${outTradeNo})`,
                        loggerCtx,
                    );
                    continue;
                }
                throw new Error(
                    `settlePayment failed for order ${outTradeNo} payment ${payment.id}: ${result.message}`,
                );
            }
            settledCount++;
            Logger.info(`Settled payment ${String(payment.id)} for order ${String(outTradeNo)}`, loggerCtx);
        }
        if (settledCount === 0) {
            Logger.info(
                `No Authorized payment to settle for order ${outTradeNo} (idempotent skip)`,
                loggerCtx,
            );
        }
    }

    private warnedMissingSellerId = false;

    @Post('notify')
    async notify(@Req() req: Request, @Res() res: Response, @Body() body: any) {
        let outTradeNo: string | undefined;
        try {
            const signType = body.sign_type || 'RSA2';

            const alipaySdk = new AlipaySdk({
                appId: body.app_id,
                privateKey: '',
                alipayPublicKey: this.options.alipayPublicKey,
                signType,
            });

            const verified = alipaySdk.checkNotifySign(body);
            if (!verified) {
                Logger.warn('Alipay notify signature verification failed', loggerCtx);
                res.send('fail');
                return;
            }

            const tradeStatus = body.trade_status;
            outTradeNo = body.out_trade_no;

            if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
                const { order, orderCtx } = await this.resolveOrder(String(outTradeNo));
                this.assertNotifyMatchesOrder(orderCtx, order, body);
                Logger.info(`Alipay trade success: ${String(outTradeNo)}, txId: ${String(body.trade_no)}`, loggerCtx);
                await this.settleOrderPayment(orderCtx, order);
            }

            // 支付宝：只有返回 success 才会停止重投
            res.send('success');
        } catch (e: any) {
            Logger.error(
                `Alipay notify error (outTradeNo=${String(outTradeNo)}): ${String(e.message)}`,
                loggerCtx,
            );
            res.send('fail');
        }
    }
}
