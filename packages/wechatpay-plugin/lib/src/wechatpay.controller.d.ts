import { Request, Response } from 'express';
import { OrderService, ChannelService, PaymentMethodService, RequestContextService, TransactionalConnection } from '@vendure/core';
import { WechatpayPluginOptions } from './types';
import { WechatpaySettlementRegistry } from './wechatpay-settlement';
export declare class WechatpayController {
    private options;
    private orderService;
    private channelService;
    private connection;
    private paymentMethodService;
    private requestContextService;
    private settlementRegistry;
    constructor(options: WechatpayPluginOptions, orderService: OrderService, channelService: ChannelService, connection: TransactionalConnection, paymentMethodService: PaymentMethodService, requestContextService: RequestContextService, settlementRegistry: WechatpaySettlementRegistry);
    /** 回调请求所属租户的 ctx：按请求域名（渠道 customFields.customDomains）解析，
     *  解析不到回退默认渠道，兼容历史单店部署。
     *  验签/解密/结算必须用「下单时那个租户」的商户凭证，否则 apiKey 不匹配解不开密。 */
    private callbackCtx;
    /** 结算路由：非订单前缀（如 RC-）交给注册的结算器，否则默认结 Vendure Order */
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
     * 构造 WxPay 实例用于通知回调中验签解密。
     * 凭证路由（分端分支付方案）：
     * 1. Host 命中 options.callbackMethodMap → 直接用该 PaymentMethod 的 args
     *    （同一 Host 下多个 method 共用商户时 apiKey 相同，任取其一即可解密验签）
     * 2. 未命中 → 渠道 override（payConfig.wechatpayJson）+ code='wechatpay' 的 PaymentMethod args
     */
    private buildWxPay;
    /**
     * 生产环境：V3 通知验签 + AES-GCM 解密
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
