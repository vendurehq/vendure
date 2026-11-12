import { ChannelService } from '@vendure/core';
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
export declare class OnebridgePaymentController {
    private channelService;
    private callbackService;
    constructor(channelService: ChannelService, callbackService: OnebridgePaymentCallbackService);
    koreaPgCallback(body: KoreaPgCallbackPayload & {
        channelToken?: string;
    }, headerToken: string | undefined, signature: string | undefined, timestamp: string | undefined, res: any): Promise<any>;
}
