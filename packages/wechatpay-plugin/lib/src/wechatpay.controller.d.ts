import { Request, Response } from 'express';
import { OrderService, ChannelService, RequestContextService, TransactionalConnection } from '@vendure/core';
import { WechatpayPluginOptions } from './types';
import { WechatpaySettlementRegistry } from './wechatpay-settlement';
export declare class WechatpayController {
    private options;
    private orderService;
    private channelService;
    private connection;
    private requestContextService;
    private settlementRegistry;
    constructor(options: WechatpayPluginOptions, orderService: OrderService, channelService: ChannelService, connection: TransactionalConnection, requestContextService: RequestContextService, settlementRegistry: WechatpaySettlementRegistry);
    private ctxFor;
    /** 回调结构化日志：单行 JSON，禁止输出私钥/apiKey/密文 */
    private logNotify;
    /**
     * 收集所有可用商户凭证（与域名无关）。
     * 微信 v3 回调的 out_trade_no 在密文里，解密前无法反查订单，
     * 故先枚举凭证并用 GCM 认证做鉴别（错误密钥必然解密失败），
     * 解密成功后再用 out_trade_no 反查 order → channel 做最终裁决。
     */
    private collectCredentials;
    private buildWxPay;
    /**
     * V3 回调验签。两种商户安全模式都要支持：
     * 1) 微信支付公钥模式：商户号已无平台证书（/v3/certificates 返回 RESOURCE_NOT_EXISTS），
     *    回调头 Wechatpay-Serial 为 PUB_KEY_ID_xxx，直接用渠道配置的微信支付公钥做 RSA-SHA256 验签；
     * 2) 平台证书模式：用 SDK 拉取平台证书验签（publicKey 非平台证书时自然落到这里）。
     * 验签失败或异常一律返回 false，由上层计入「凭证不匹配」分支。
     */
    private verifyNotifySignature;
    /**
     * 由 out_trade_no 反查渠道（不做任何 Host 解析）。
     * 结算类前缀（CS-/BP- 等）优先走注册器；否则按全局订单号查 order.channels，
     * 并与「凭证试解成功的渠道集合」取交集，交集为空即拒绝（防跨渠道结算）。
     */
    private resolveChannelForOutTradeNo;
    /** 仅用于 dev 端点：按订单号取所属渠道 ctx（回调正式路径不用） */
    private resolveOrderChannelCtx;
    /** 结算路由：非订单前缀（如 CS-/BP-）交给注册的结算器，否则默认结 Vendite Order。
     *  expectedAmountCents：微信回调解密出的金额（分），用于与 Authorized 支付金额比对。 */
    private routeSettlement;
    /**
     * 结算订单支付：dev-notify 和 notify 共用
     * 查询 Authorized 状态的支付并调用 settlePayment。
     * 失败必须抛错（由外层返回 500/FAIL），让微信重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，平台重复通知天然幂等。
     * 注意：订单到达 PaymentAuthorized 后 active=false，不能用 order.active 判断
     */
    private settleOrderPayment;
    /**
     * 生产环境：V3 通知验签 + AES-GCM 解密
     * 渠道归属完全由报文内的 out_trade_no 决定（凭证试解 → 订单反查），与回调域名无关。
     */
    notify(req: Request, res: Response, body: any): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * Dev Bypass: 模拟微信支付页面
     * 安全门禁：控制器注册是静态装饰器元数据，无法按运行时 options 省略路由，
     * 故仅在显式开启 devBypass 时可用，否则返回 404（不暴露该端点存在）。
     */
    getDevPayPage(req: Request, res: Response): Response<any, Record<string, any>> | undefined;
    /**
     * Dev Bypass: 自动回调，结算订单或走注册表结算
     * 安全门禁：无验签、直接结算，匿名可零元结算订单/免费充值，
     * 故仅在显式开启 devBypass 时可用，否则返回 404。
     */
    devNotify(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
