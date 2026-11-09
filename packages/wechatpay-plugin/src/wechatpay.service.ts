import { Inject, Injectable } from '@nestjs/common';
import {
    ChannelService,
    Customer,
    CustomerService,
    ID,
    Logger,
    PaymentMethodService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import crypto from 'crypto';
import WxPay from 'wechatpay-node-v3';
// 断开循环依赖（同 wechatpay-handler.ts 注释）：从叶子模块导入，不经 cjk 主入口
import { getPaymentOverride } from '@vendure/cjk-plugin/lib/src/payment/payment-config';
import type { WechatpayCredentials } from '@vendure/cjk-plugin';

import { WECHATPAY_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { WechatpayPluginOptions } from './types';

/**
 * 结算币种：按请求所属渠道取（CT-05 要求 ONE BRIDGE 走 KRW，不得硬编码 CNY）。
 * 未传 ctx 的历史调用（内部对账等）沿用微信默认结算币种 CNY。
 */
function resolveCurrency(ctx?: RequestContext): string {
    return ctx?.channel?.defaultCurrencyCode || 'CNY';
}


export interface BarePaymentInput {
    outTradeNo: string;
    /** 金额：分 */
    amount: number;
    tradeType?: 'JSAPI' | 'NATIVE' | 'H5' | 'APP';
    openid?: string;
    description?: string;
    /** 指定支付方法 code（分端分支付方案：充值/代付按端选方法，如 'wechatpay' / 'wechatpay-youshop-jsapi'）。
     *  显式指定时优先用该方法的 args，不再叠加渠道 override。 */
    methodCode?: string;
}

export interface BareRefundInput {
    outTradeNo: string;
    outRefundNo: string;
    /** 退款金额：分 */
    refund: number;
    /** 原订单金额：分 */
    total: number;
    reason?: string;
    /** 指定支付方法 code（同 BarePaymentInput.methodCode 口径） */
    methodCode?: string;
}

export interface BareRefundResult {
    refundId?: string;
    outRefundNo?: string;
    /** 微信退款状态：SUCCESS/CLOSED/PROCESSING/ABNORMAL 等 */
    status?: string;
}

export interface BarePaymentResult {
    payType: string;
    prepayId?: string;
    appId?: string;
    timeStamp?: string;
    nonceStr?: string;
    package?: string;
    signType?: string;
    paySign?: string;
    payUrl?: string;
}

/**
 * 进程内 WechatpayService 引用（沿用本项目 `setWechatpayGateway` / `getPaymentOverride`
 * 的注册模式），供支付 handler 与其它插件在无 DI 上下文处推导 openid。
 * 未注册（未装载 WechatpayPlugin）时为 null，推导一律返回 undefined。
 */
let wechatpayServiceRef: WechatpayService | null = null;

export function setWechatpayServiceRef(service: WechatpayService | null): void {
    wechatpayServiceRef = service;
}

/** 由客户档案推导 openid 的模块级入口（失败不阻断支付，仅记日志后返回 undefined） */
export async function resolveCustomerOpenid(
    ctx: RequestContext,
    customerId?: ID | null,
    opts?: { preferMini?: boolean },
): Promise<string | undefined> {
    if (!wechatpayServiceRef) return undefined;
    try {
        return await wechatpayServiceRef.resolveCustomerOpenid(ctx, customerId, opts);
    } catch (e: any) {
        Logger.warn(`resolveCustomerOpenid failed: ${e.message}`, loggerCtx);
        return undefined;
    }
}

@Injectable()
export class WechatpayService {
    constructor(
        @Inject(WECHATPAY_PLUGIN_OPTIONS) private options: WechatpayPluginOptions,
        private channelService: ChannelService,
        private paymentMethodService: PaymentMethodService,
        private connection: TransactionalConnection,
        private customerService: CustomerService,
    ) {}

    /**
     * 由客户档案推导微信 openid（F-VS-08）。
     * openid 由微信授权登录时写入 `Customer.customFields.wechatOpenid` / `wechatMiniOpenid`，
     * 支付时无需（也不应）依赖前端本地存储。
     * 仅存其一则用之；两者都有时按 `preferMini` 取舍（默认优先公众号 openid）。
     */
    async resolveCustomerOpenid(
        ctx: RequestContext,
        customerId?: ID | null,
        opts?: { preferMini?: boolean },
    ): Promise<string | undefined> {
        let id = customerId;
        if ((id === undefined || id === null) && ctx.activeUserId) {
            const byUser = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
            id = byUser?.id;
        }
        if (id === undefined || id === null) return undefined;
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { id: id as any },
        });
        const cf = (customer?.customFields ?? {}) as any;
        const official: string | undefined = cf.wechatOpenid || undefined;
        const mini: string | undefined = cf.wechatMiniOpenid || undefined;
        if (official && mini) return opts?.preferMini ? mini : official;
        return mini || official;
    }

    /** 默认渠道 ctx（未按租户指定渠道时的回退，兼容历史单店部署） */
    private async defaultChannelCtx(): Promise<RequestContext> {
        const channel = await this.channelService.getDefaultChannel();
        return new RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }

    /** 微信错误体优先取 {code,message}（errRaw.response.text / error），避免长 JSON 截断后丢失错误码 */
    private wxErrorText(r: any): string {
        const detail = r?.error || r?.errRaw?.response?.text || JSON.stringify(r?.data ?? r);
        return String(detail ?? '').slice(0, 600);
    }

    /** 集中构造配置好的 WxPay 实例 + 凭证（复用 getPaymentOverride）。
     *  传入 ctx 时使用「该 ctx 所属租户」的凭证与回调地址；缺省回退默认渠道。
     *  显式传 methodCode（分端分支付方案）时直接用该方法的 args，不再叠加渠道 override。 */
    private async buildWechatpay(ctx?: RequestContext, methodCode?: string): Promise<{
        pay: WxPay;
        appId: string;
        privateKey: string;
        tradeType: string;
        notifyUrl: string;
    }> {
        const effectiveCtx = ctx ?? (await this.defaultChannelCtx());
        const explicitCode = methodCode || '';
        const override = explicitCode
            ? null
            : (getPaymentOverride(effectiveCtx, 'wechatpay') as WechatpayCredentials | null);
        const pm = await this.findPaymentMethod(effectiveCtx, explicitCode || 'wechatpay', !!explicitCode);
        const args = pm?.handler?.args || [];
        const getArg = (name: string) => args.find(a => a.name === name)?.value || '';
        const appId = override?.appId || getArg('appId');
        const privateKey = override?.privateKey || getArg('privateKey');
        // 渠道既没绑微信支付方法、也没有 payConfig override 时，不能继续用空参数构造 WxPay：
        // wechatpay-node-v3 会在 getSN 解析空公钥/私钥时抛 "PEM: no block"，用户侧表现为莫名支付失败。
        if (!appId || !privateKey) {
            throw new UserInputError(
                `微信支付未配置：店铺 ${effectiveCtx.channel?.code ?? ''} 缺少可用的微信支付方式或渠道商户参数（payConfig.wechatpay）`,
            );
        }
        return {
            pay: new WxPay({
                appid: appId,
                mchid: override?.mchId || getArg('mchId'),
                publicKey: Buffer.from(override?.publicKey || getArg('publicKey')),
                privateKey: Buffer.from(privateKey),
                key: override?.apiKey || getArg('apiKey'),
                serial_no: override?.serialNo || getArg('serialNo'),
            }),
            appId,
            privateKey,
            tradeType: override?.tradeType || getArg('tradeType') || 'JSAPI',
            notifyUrl: override?.notifyUrl || getArg('notifyUrl') || this.options?.notifyUrl || '',
        };
    }

    /**
     * 按 code 找支付方法：显式 code 只做精确匹配；隐式 'wechatpay' 时依次回退
     * 「渠道内任一微信支付处理器方法（wechatpay-xxx）」→「默认渠道同名方法」。
     * 分租户只配了渠道 override、或只配了 wechatpay-xxx 方法时都不会再取到空参数。
     */
    private async findPaymentMethod(ctx: RequestContext, code: string, exactOnly: boolean) {
        const pms = await this.paymentMethodService.findAll(ctx);
        const exact = pms.items.find(p => p.code === code);
        if (exact || exactOnly) return exact;
        const sibling = pms.items.find(p => (p.handler as any)?.code?.startsWith('wechatpay'));
        if (sibling) return sibling;
        const defaultPms = await this.paymentMethodService.findAll(await this.defaultChannelCtx());
        return (
            defaultPms.items.find(p => p.code === code) ||
            defaultPms.items.find(p => (p.handler as any)?.code?.startsWith('wechatpay'))
        );
    }

    /** 渠道是否配置了微信支付商户凭证（payConfig.wechatpayJson）。
     *  有 override = 该租户自带商户参数（公众号/H5 场景），JSAPI 应取公众号 openid；
     *  无 override 回退平台默认支付方式（小程序 appid），沿用小程序 openid 优先。 */
    hasChannelPayConfig(ctx: RequestContext): boolean {
        return !!getPaymentOverride(ctx, 'wechatpay');
    }

    /** devBypass 下返回模拟支付页；否则调真实微信 API 生成支付参数。
     *  ctx 决定用哪个租户的商户凭证与回调地址（CS-/RC- 等代付单须传自身 ctx）。 */
    async createBarePayment(input: BarePaymentInput, ctx?: RequestContext): Promise<BarePaymentResult> {
        if (this.options?.devBypass) {
            return {
                payType: 'dev-h5',
                payUrl: `/wechatpay/dev-pay?outTradeNo=${encodeURIComponent(input.outTradeNo)}`,
            };
        }
        const { pay, appId, privateKey, tradeType, notifyUrl } = await this.buildWechatpay(ctx, input.methodCode);
        const baseParams = {
            description: input.description || `Pay ${input.outTradeNo}`,
            out_trade_no: input.outTradeNo,
            notify_url: notifyUrl,
            // 单位：input.amount 为「分」（见 BarePaymentInput 定义），微信 V3 amount.total 同为
            // 「分」，故直接透传，切勿再 /100（否则少收 100 倍）。
            // 币种按渠道取（CT-05：ONE BRIDGE 为 KRW）；未传 ctx 时沿用微信默认结算币种 CNY。
            amount: { total: Math.round(input.amount), currency: resolveCurrency(ctx) },
        };
        const type = input.tradeType || tradeType;

        if (type === 'NATIVE') {
            const r = (await pay.transactions_native(baseParams)) as any;
            return { payType: 'native', payUrl: r?.data?.code_url };
        }
        if (type === 'H5') {
            const r = (await pay.transactions_h5({
                ...baseParams,
                scene_info: {
                    payer_client_ip: '127.0.0.1',
                    h5_info: { type: 'Wap', app_name: 'Vendure' },
                },
            })) as any;
            return { payType: 'h5', payUrl: r?.data?.h5_url };
        }
        if (type === 'APP') {
            const r = (await pay.transactions_app(baseParams)) as any;
            // wechatpay-node-v3 v2.2 起：成功时会把 data 替换为已签名参数（prepayid），不再保留 prepay_id
            const d = r?.data ?? {};
            return { payType: 'app', prepayId: d.prepay_id ?? d.prepayid };
        }
        // JSAPI
        const r = (await pay.transactions_jsapi({
            ...baseParams,
            payer: { openid: input.openid || '' },
        })) as any;
        // 成功时库会把 data 替换为已签名参数（package=prepay_id=xxx / paySign），
        // 故 prepay_id 需从 package 反解，否则会把 200 成功误判为失败（实测 t1 券支付踩中）
        const data = r?.data ?? {};
        const prepayId =
            data.prepay_id ||
            (typeof data.package === 'string' && data.package.startsWith('prepay_id=')
                ? data.package.slice('prepay_id='.length)
                : undefined);
        // 同 handler：微信失败响应不 reject，缺 prepay_id 时显式报错（勿产出 prepay_id=undefined 假参数）
        if (!prepayId) {
            throw new Error(`微信 JSAPI 下单失败(status=${r?.status}): ${this.wxErrorText(r)}`);
        }
        const timeStamp = String(Math.floor(Date.now() / 1000));
        const nonceStr = Math.random().toString(36).substring(2, 34);
        const pkg = `prepay_id=${prepayId}`;
        const paySign = crypto
            .sign('RSA-SHA256', Buffer.from(`${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`), {
                key: Buffer.from(privateKey),
            })
            .toString('base64');
        return { payType: 'jsapi', prepayId, appId, timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
    }

    /** 裸退款（POST /v3/refund/domestic/refunds）：ctx 决定用哪个租户的商户凭证（同 createBarePayment）。
     *  微信侧错误（非 2xx 或无 refund_id）显式抛出，供调用方落 failed 走重试。 */
    async refundBarePayment(ctx: RequestContext | undefined, input: BareRefundInput): Promise<BareRefundResult> {
        if (this.options?.devBypass) {
            // devBypass 与 createBarePayment 同源短路：开发环境不向真实商户号发起退款
            return { status: 'SUCCESS' };
        }
        const { pay } = await this.buildWechatpay(ctx, input.methodCode);
        const r = (await pay.refunds({
            out_trade_no: input.outTradeNo,
            out_refund_no: input.outRefundNo,
            reason: input.reason,
            amount: { refund: Math.round(input.refund), total: Math.round(input.total), currency: resolveCurrency(ctx) },
        })) as any;
        const data = r?.data ?? {};
        if (!data.refund_id) {
            throw new Error(`微信退款发起失败(status=${r?.status}): ${this.wxErrorText(r)}`);
        }
        return { refundId: data.refund_id, outRefundNo: data.out_refund_no, status: data.status };
    }

    /** 查询单笔退款（GET /v3/refund/domestic/refunds/{out_refund_no}），供卡单对账；查无记录返回 null。 */
    async findBareRefund(
        ctx: RequestContext | undefined,
        outRefundNo: string,
        methodCode?: string,
    ): Promise<BareRefundResult | null> {
        if (this.options?.devBypass) {
            // devBypass 短路：视为查无退款记录（调用方将走同 refundNo 幂等重发，而重发亦被 devBypass 拦截）
            return null;
        }
        const { pay } = await this.buildWechatpay(ctx, methodCode);
        const r = (await pay.find_refunds(outRefundNo)) as any;
        const data = r?.data ?? null;
        if (!data?.out_refund_no) return null;
        return { refundId: data.refund_id, outRefundNo: data.out_refund_no, status: data.status };
    }
}