import { ChannelService } from '@vendure/core';
import { KoreaPgCallbackPayload, OnebridgePaymentCallbackService } from './payment-callback.service';
/**
 * 韩国 PG 异步回调入口（CT-05 一期桩）。
 * 路径：POST /onebridge/payments/korea-pg/callback
 * 渠道解析：body.channelToken → 请求头 vendure-token → 默认渠道。
 * 响应契约（固定，便于 PG 侧对接）：200 已处理/重复；400 参数或订单校验失败，body 带 code。
 * TODO(真实 PG)：验签（PG 公钥/摘要）与重放窗口校验；一期桩不校验签名。
 */
export declare class OnebridgePaymentController {
    private channelService;
    private callbackService;
    constructor(channelService: ChannelService, callbackService: OnebridgePaymentCallbackService);
    koreaPgCallback(body: KoreaPgCallbackPayload & {
        channelToken?: string;
    }, headerToken: string | undefined, res: any): Promise<any>;
}
