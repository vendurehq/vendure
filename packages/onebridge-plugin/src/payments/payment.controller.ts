import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import { ChannelService, Logger, RequestContext } from '@vendure/core';

import { loggerCtx, ONEBRIDGE_ERROR_CODES } from '../types';
import {
    isSignatureRequired,
    KOREA_PG_SIGNATURE_HEADER,
    KOREA_PG_TIMESTAMP_HEADER,
    verifyKoreaPgCallback,
} from './callback-signature';
import { KoreaPgCallbackPayload, OnebridgePaymentCallbackService } from './payment-callback.service';

/**
 * 韩国 PG 异步回调入口（CT-05）。
 * 路径：POST /onebridge/payments/korea-pg/callback
 * 渠道解析：body.channelToken → 请求头 vendure-token → 默认渠道。
 * 响应契约（固定，便于 PG 侧对接）：
 *   200 已处理/重复；400 参数或订单校验失败；401 验签失败/缺失（body 带 code）。
 *
 * 验签口径（B-04）：
 *   - 秘钥来自环境变量 KOREA_PG_CALLBACK_SECRET（不落库、不硬编码）；
 *   - 请求头 `x-onebridge-signature` = hex(HMAC-SHA256(secret, 签名原文))，
 *     原文见 callback-signature.ts（orderCode|transactionId|status|amount|currencyCode|timestamp）；
 *   - 请求头 `x-onebridge-timestamp` 为秒级时间戳，允许 ±300s 偏移（防重放）；
 *   - 生产环境（NODE_ENV=production）未配秘钥时一律拒绝，避免零成本伪造写入；
 *     本地/种子脚本可用 KOREA_PG_REQUIRE_SIGNATURE=0 显式关闭。
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
        @Headers(KOREA_PG_SIGNATURE_HEADER) signature: string | undefined,
        @Headers(KOREA_PG_TIMESTAMP_HEADER) timestamp: string | undefined,
        @Res() res: any,
    ) {
        const secret = process.env.KOREA_PG_CALLBACK_SECRET ?? '';
        const requireSignature = isSignatureRequired();
        if (!secret && requireSignature) {
            Logger.error(
                `${ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_MISSING} KOREA_PG_CALLBACK_SECRET 未配置，生产回调已拒绝`,
                loggerCtx,
            );
            return res.status(401).json({
                success: false,
                code: ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_MISSING,
                message: 'Callback secret is not configured on server',
            });
        }
        if (secret && body) {
            const verdict = verifyKoreaPgCallback(secret, body, signature, timestamp);
            if (!verdict.ok) {
                const code =
                    verdict.code === 'SIGNATURE_MISSING'
                        ? ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_MISSING
                        : ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_INVALID;
                Logger.warn(
                    `${code} orderCode=${body.orderCode ?? '-'} reason=${verdict.code}`,
                    loggerCtx,
                );
                return res.status(401).json({
                    success: false,
                    code,
                    message: `Callback signature rejected: ${verdict.code}`,
                });
            }
        } else if (!secret) {
            Logger.warn(
                'korea-pg callback 未配置 KOREA_PG_CALLBACK_SECRET，按非生产环境放行（生产必须配置）',
                loggerCtx,
            );
        }

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
