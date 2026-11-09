import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { ChannelService, Logger, RequestContext } from '@vendure/core';

import { loggerCtx, ONEBRIDGE_ERROR_CODES } from '../types';
import { KoreaPgCallbackPayload, OnebridgePaymentCallbackService } from './payment-callback.service';

/**
 * 韩国 PG 异步回调入口（CT-05 一期桩）。
 * 路径：POST /onebridge/payments/korea-pg/callback
 * 渠道解析：body.channelToken → 请求头 vendure-token → 默认渠道。
 * 响应契约（固定，便于 PG 侧对接）：200 已处理/重复；400 参数或订单校验失败，body 带 code。
 * TODO(真实 PG)：验签（PG 公钥/摘要）与重放窗口校验；一期桩不校验签名。
 */
@Controller('onebridge/payments')
export class OnebridgePaymentController {
    constructor(
        private channelService: ChannelService,
        private callbackService: OnebridgePaymentCallbackService,
    ) {}

    @Post('korea-pg/callback')
    async koreaPgCallback(
        @Body() body: KoreaPgCallbackPayload & { channelToken?: string },
        @Headers('vendure-token') headerToken: string | undefined,
        @Res() res: any,
    ) {
        const token = body?.channelToken?.trim() || headerToken?.trim() || undefined;
        const channel = token
            ? await this.channelService.getChannelFromToken(token).catch(() => null)
            : await this.channelService.getDefaultChannel().catch(() => null);
        if (!channel) {
            return res.status(400).json({
                success: false,
                code: ONEBRIDGE_ERROR_CODES.CHANNEL_NOT_RESOLVED,
                message: `Channel not resolved: ${token ?? '<default>'}`,
            });
        }
        const ctx = new RequestContext({
            apiType: 'shop',
            channel,
            isAuthorized: false,
            authorizedAsOwnerOnly: false,
        });
        try {
            const result = await this.callbackService.handleKoreaPg(ctx, body);
            return res.status(200).json(result);
        } catch (e: any) {
            Logger.warn(`korea-pg callback rejected: ${e?.message}`, loggerCtx);
            return res.status(400).json({
                success: false,
                code: e?.code ?? 'PAYMENT_CALLBACK_INVALID',
                message: e?.message ?? 'Invalid callback payload',
            });
        }
    }
}
