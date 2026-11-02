import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { Logger, Order, OrderService, Payment, ChannelService, RequestContext, TransactionalConnection, isGraphQlErrorResult } from '@vendure/core';

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

    /**
     * 结算订单支付。失败必须抛错（外层返回 failure）触发支付宝重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，重复通知天然幂等。
     */
    private async settleOrderPayment(outTradeNo: string): Promise<void> {
        const channel = await this.channelService.getDefaultChannel();
        const ctx = new RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
        // 默认渠道未必是下单渠道：先全局按 code 取单，再切到订单所属渠道结算
        const base = await this.connection.getRepository(ctx, Order).findOne({
            where: { code: outTradeNo },
            relations: ['channels'],
        });
        if (!base) {
            Logger.error(`Alipay settle: order ${outTradeNo} not found (any channel)`, loggerCtx);
            throw new Error(`order ${outTradeNo} not found`);
        }
        const orderChannel =
            base.channels?.find(c => Number(c.id) === Number(ctx.channelId)) ?? base.channels?.[0];
        const orderCtx =
            orderChannel && Number(orderChannel.id) !== Number(ctx.channelId)
                ? new RequestContext({
                      apiType: 'admin',
                      channel: orderChannel,
                      isAuthorized: true,
                      authorizedAsOwnerOnly: false,
                  })
                : ctx;
        const order = await this.orderService.findOneByCode(orderCtx, outTradeNo, ['payments']);
        if (!order) {
            Logger.error(
                `Alipay settle: order ${outTradeNo} not found in channel ${orderCtx.channelId}`,
                loggerCtx,
            );
            throw new Error(`order ${outTradeNo} not found in channel ${orderCtx.channelId}`);
        }
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

    @Post('notify')
    async notify(@Req() req: Request, @Res() res: Response, @Body() body: any) {
        let outTradeNo: string | undefined;
        try {
            const sign = body.sign;
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
                Logger.info(`Alipay trade success: ${String(outTradeNo)}, txId: ${String(body.trade_no)}`, loggerCtx);
                await this.settleOrderPayment(String(outTradeNo));
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
