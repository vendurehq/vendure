import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import WxPay from 'wechatpay-node-v3';
import {
    Logger,
    Order,
    OrderService,
    ChannelService,
    Payment,
    PaymentMethodService,
    RequestContext,
    RequestContextService,
    TransactionalConnection,
    isGraphQlErrorResult,
} from '@vendure/core';
// 断开循环依赖（同 wechatpay-handler.ts 注释）：从叶子模块导入，不经 cjk 主入口
import { findChannelByDomain } from '@vendure/cjk-plugin/lib/src/tenant/domain-resolver.service';
import { getPaymentOverride } from '@vendure/cjk-plugin/lib/src/payment/payment-config';
import type { WechatpayCredentials } from '@vendure/cjk-plugin';

import { WECHATPAY_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { WechatpayPluginOptions } from './types';
import { WechatpaySettlementRegistry } from './wechatpay-settlement';

@Controller('wechatpay')
export class WechatpayController {
    constructor(
        @Inject(WECHATPAY_PLUGIN_OPTIONS) private options: WechatpayPluginOptions,
        private orderService: OrderService,
        private channelService: ChannelService,
        private connection: TransactionalConnection,
        private paymentMethodService: PaymentMethodService,
        private requestContextService: RequestContextService,
        private settlementRegistry: WechatpaySettlementRegistry,
    ) {}

    /** 回调请求所属租户的 ctx：按请求域名（渠道 customFields.customDomains）解析，
     *  解析不到回退默认渠道，兼容历史单店部署。
     *  验签/解密/结算必须用「下单时那个租户」的商户凭证，否则 apiKey 不匹配解不开密。 */
    private async callbackCtx(req: Request): Promise<RequestContext> {
        const host = req.hostname || (req.headers.host as string) || '';
        const channel =
            (await findChannelByDomain(this.channelService, host)) ??
            (await this.channelService.getDefaultChannel());
        return new RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }

    /** 结算路由：非订单前缀（如 RC-）交给注册的结算器，否则默认结 Vendure Order */
    private async routeSettlement(
        ctx: RequestContext,
        outTradeNo: string,
        transactionId: string,
    ): Promise<void> {
        const settlement = this.settlementRegistry.find(outTradeNo);
        if (settlement) {
            await settlement.settle(ctx, outTradeNo, transactionId);
            return;
        }
        await this.settleOrderPayment(ctx, outTradeNo);
    }

    /**
     * 结算订单支付：dev-notify 和 notify 共用
     * 查询 Authorized 状态的支付并调用 settlePayment。
     * 失败必须抛错（由外层返回 500/FAIL），让微信重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，平台重复通知天然幂等。
     * 注意：订单到达 PaymentAuthorized 后 active=false，不能用 order.active 判断
     */
    private async settleOrderPayment(ctx: RequestContext, orderCode: string): Promise<void> {
        // 回调域名解析出的渠道未必是下单渠道（如 t1 站点回调落 www.youshop.cn 时回退默认渠道），
        // 而 OrderService.findOne 会按 ctx 渠道过滤 → 查不到单，微信已扣款却不结单。
        // 故先全局按 code 取单和它所属渠道，再切到该渠道 ctx 去查单/结算。
        const base = await this.connection.getRepository(ctx, Order).findOne({
            where: { code: orderCode },
            relations: ['channels'],
        });
        if (!base) {
            Logger.error(`settleOrderPayment: order ${orderCode} not found (any channel)`, loggerCtx);
            throw new Error(`order ${orderCode} not found`);
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
        const order = await this.orderService.findOneByCode(orderCtx, orderCode, ['payments']);
        if (!order) {
            Logger.error(
                `settleOrderPayment: order ${orderCode} not found in channel ${orderCtx.channelId}`,
                loggerCtx,
            );
            throw new Error(`order ${orderCode} not found in channel ${orderCtx.channelId}`);
        }
        const payments = order.payments || [];
        let settledCount = 0;
        for (const payment of payments) {
            // 幂等：已 Settled / 已取消等非 Authorized 状态直接跳过，重复通知不会重复结算
            if (payment.state !== 'Authorized') {
                continue;
            }
            const result = await this.orderService.settlePayment(orderCtx, payment.id);
            if (isGraphQlErrorResult(result)) {
                // 并发重复通知：另一路已抢先结算成功时重查状态，已 Settled 视为幂等成功
                const fresh = await this.connection
                    .getRepository(orderCtx, Payment)
                    .findOne({ where: { id: payment.id } });
                if (fresh?.state === 'Settled') {
                    Logger.info(
                        `Payment ${payment.id} already settled by concurrent notify, skip (outTradeNo=${orderCode})`,
                        loggerCtx,
                    );
                    continue;
                }
                throw new Error(
                    `settlePayment failed for order ${orderCode} payment ${payment.id}: ${result.message}`,
                );
            }
            settledCount++;
            Logger.info(`Settled payment ${payment.id} for order ${orderCode}`, loggerCtx);
        }
        if (settledCount === 0) {
            Logger.info(
                `No Authorized payment to settle for order ${orderCode} (idempotent skip)`,
                loggerCtx,
            );
        }
    }

    /**
     * 构造 WxPay 实例用于通知回调中验签解密。
     * 凭证路由（分端分支付方案）：
     * 1. Host 命中 options.callbackMethodMap → 直接用该 PaymentMethod 的 args
     *    （同一 Host 下多个 method 共用商户时 apiKey 相同，任取其一即可解密验签）
     * 2. 未命中 → 渠道 override（payConfig.wechatpayJson）+ code='wechatpay' 的 PaymentMethod args
     */
    private async buildWxPay(ctx: RequestContext, host: string): Promise<{
        pay: WxPay;
        apiKey: string;
    }> {
        const mapCode = this.options?.callbackMethodMap?.[host];
        const pms = await this.paymentMethodService.findAll(ctx);
        const mapped = mapCode ? pms.items.find(p => p.code === mapCode) : undefined;
        const mappedApiKey = mapped?.handler?.args?.find(a => a.name === 'apiKey')?.value || '';
        // 映射到的方法若没有商户凭证（如仅作占位、未填 key 的 wechatpay-xxx），不能只用它验签：
        // apiKey 为空会让验签恒失败、回调 401（微信重试后仍失败 → 已付款但不结单/不发券）。
        // 此时回退到「渠道 override + wechatpay」这条既有主链。
        const useMapped = !!mapped && !!mappedApiKey;
        let override: WechatpayCredentials | null = null;
        let methodCode = 'wechatpay';
        if (useMapped) {
            methodCode = mapCode as string;
        } else {
            override = getPaymentOverride(ctx, 'wechatpay') as WechatpayCredentials | null;
            if (mapCode && !useMapped) {
                Logger.warn(
                    `callbackMethodMap[${host}]=${mapCode} 缺少商户凭证，回退 wechatpay 验签`,
                    loggerCtx,
                );
            }
        }
        const pm = pms.items.find(p => p.code === methodCode);
        const args = pm?.handler?.args || [];
        const getArg = (name: string) => args.find(a => a.name === name)?.value || '';
        const apiKey = override?.apiKey || getArg('apiKey');

        const pay = new WxPay({
            appid: override?.appId || getArg('appId'),
            mchid: override?.mchId || getArg('mchId'),
            publicKey: Buffer.from(override?.publicKey || getArg('publicKey')),
            privateKey: Buffer.from(override?.privateKey || getArg('privateKey')),
            key: apiKey,
            serial_no: override?.serialNo || getArg('serialNo'),
        });

        return { pay, apiKey };
    }

    /**
     * 生产环境：V3 通知验签 + AES-GCM 解密
     */
    @Post('notify')
    async notify(@Req() req: Request, @Res() res: Response, @Body() body: any) {
        try {
            const {
                'wechatpay-timestamp': timestamp,
                'wechatpay-nonce': nonce,
                'wechatpay-signature': signature,
                'wechatpay-serial': serial,
            } = req.headers as any;

            const resource = body?.resource;
            if (!resource) {
                return res.status(400).json({ code: 'FAIL', message: 'missing resource' });
            }

            const ctx = await this.callbackCtx(req);
            const host = req.hostname || (req.headers.host as string) || '';
            const { pay, apiKey } = await this.buildWxPay(ctx, host);

            // 1. 验签
            const bodyStr = JSON.stringify(body);
            const verified = pay.verifySign({
                timestamp,
                nonce,
                body: bodyStr,
                serial,
                signature,
                apiSecret: apiKey,
            });
            if (!verified) {
                Logger.warn('WeChat Pay notify signature verification failed', loggerCtx);
                return res.status(401).json({ code: 'FAIL', message: '签名验证失败' });
            }

            // 2. AES-GCM 解密
            const decrypted = pay.decipher_gcm(
                resource.ciphertext,
                resource.associated_data,
                resource.nonce,
            ) as { out_trade_no?: string; transaction_id?: string };
            const outTradeNo = decrypted?.out_trade_no;
            const transactionId = decrypted?.transaction_id;

            Logger.info(
                `WeChat Pay trade success: ${outTradeNo}, txId: ${transactionId}`,
                loggerCtx,
            );

            // 3. 处理支付结果
            if (body?.event_type === 'TRANSACTION.SUCCESS' && outTradeNo) {
                await this.routeSettlement(ctx, outTradeNo, transactionId || '');
            }

            res.status(200).json({ code: 'SUCCESS', message: 'OK' });
        } catch (e: any) {
            Logger.error(`WeChat Pay notify error: ${e.message}`, loggerCtx);
            res.status(500).json({ code: 'FAIL', message: e.message });
        }
    }

    /**
     * Dev Bypass: 模拟微信支付页面
     * 安全门禁：控制器注册是静态装饰器元数据，无法按运行时 options 省略路由，
     * 故仅在显式开启 devBypass 时可用，否则返回 404（不暴露该端点存在）。
     */
    @Get('dev-pay')
    getDevPayPage(@Req() req: Request, @Res() res: Response) {
        if (!this.options?.devBypass) {
            return res.status(404).send('Not Found');
        }
        const outTradeNo = (req.query as any).outTradeNo as string;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>模拟微信支付</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding:40px;">
    <h2>模拟微信支付</h2>
    <p>订单号: ${outTradeNo}</p>
    <button onclick="pay()" style="padding:12px 40px;font-size:16px;background:#07c160;color:#fff;border:none;border-radius:4px;cursor:pointer;">
        模拟支付成功
    </button>
    <p id="msg" style="margin-top:20px;color:#666;"></p>
    <script>
        async function pay() {
            document.getElementById('msg').innerText = '正在处理...';
            try {
                const res = await fetch('/wechatpay/dev-notify?outTradeNo=${outTradeNo}', {
                    method: 'POST'
                });
                const data = await res.json();
                if (data.code === 'SUCCESS') {
                    document.body.innerHTML =
                        '<h2 style="color:#07c160">支付成功</h2>' +
                        '<p>订单: ${outTradeNo}</p>' +
                        '<a href="/" style="color:#576b95;">返回商城</a>';
                } else {
                    document.getElementById('msg').innerText = '支付失败: ' + (data.message || '未知错误');
                }
            } catch (e) {
                document.getElementById('msg').innerText = '请求失败: ' + e.message;
            }
        }
    </script>
</body>
</html>`);
    }

    /**
     * Dev Bypass: 自动回调，结算订单或走注册表结算
     * 安全门禁：无验签、直接结算，匿名可零元结算订单/免费充值，
     * 故仅在显式开启 devBypass 时可用，否则返回 404。
     */
    @Post('dev-notify')
    async devNotify(@Req() req: Request, @Res() res: Response) {
        if (!this.options?.devBypass) {
            return res.status(404).json({ code: 'FAIL', message: 'Not Found' });
        }
        const outTradeNo = (req.query as any).outTradeNo as string;
        try {
            if (!outTradeNo) {
                return res.status(400).json({ code: 'FAIL', message: 'missing outTradeNo' });
            }
            await this.routeSettlement(await this.callbackCtx(req), outTradeNo, 'DEV-TX');
            res.status(200).json({ code: 'SUCCESS', message: 'OK' });
        } catch (e: any) {
            Logger.error(`WeChat Pay dev-notify error: ${e.message}`, loggerCtx);
            res.status(500).json({ code: 'FAIL', message: e.message });
        }
    }
}
