"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatpayController = void 0;
const common_1 = require("@nestjs/common");
const wechatpay_node_v3_1 = __importDefault(require("wechatpay-node-v3"));
const core_1 = require("@vendure/core");
// 断开循环依赖（同 wechatpay-handler.ts 注释）：从叶子模块导入，不经 cjk 主入口
const domain_resolver_service_1 = require("@vendure/cjk-plugin/lib/src/tenant/domain-resolver.service");
const payment_config_1 = require("@vendure/cjk-plugin/lib/src/payment/payment-config");
const constants_1 = require("./constants");
const wechatpay_settlement_1 = require("./wechatpay-settlement");
let WechatpayController = class WechatpayController {
    constructor(options, orderService, channelService, connection, paymentMethodService, requestContextService, settlementRegistry) {
        this.options = options;
        this.orderService = orderService;
        this.channelService = channelService;
        this.connection = connection;
        this.paymentMethodService = paymentMethodService;
        this.requestContextService = requestContextService;
        this.settlementRegistry = settlementRegistry;
    }
    /** 回调请求所属租户的 ctx：按请求域名（渠道 customFields.customDomains）解析，
     *  解析不到回退默认渠道，兼容历史单店部署。
     *  验签/解密/结算必须用「下单时那个租户」的商户凭证，否则 apiKey 不匹配解不开密。 */
    async callbackCtx(req) {
        var _a;
        const host = req.hostname || req.headers.host || '';
        const channel = (_a = (await (0, domain_resolver_service_1.findChannelByDomain)(this.channelService, host))) !== null && _a !== void 0 ? _a : (await this.channelService.getDefaultChannel());
        return new core_1.RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }
    /** 结算路由：非订单前缀（如 RC-）交给注册的结算器，否则默认结 Vendure Order。
     *  expectedAmountCents：微信回调解密出的金额（分），用于与 Authorized 支付金额比对。 */
    async routeSettlement(ctx, outTradeNo, transactionId, expectedAmountCents) {
        const settlement = this.settlementRegistry.find(outTradeNo);
        if (settlement) {
            await settlement.settle(ctx, outTradeNo, transactionId);
            return;
        }
        await this.settleOrderPayment(ctx, outTradeNo, expectedAmountCents);
    }
    /**
     * 结算订单支付：dev-notify 和 notify 共用
     * 查询 Authorized 状态的支付并调用 settlePayment。
     * 失败必须抛错（由外层返回 500/FAIL），让微信重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，平台重复通知天然幂等。
     * 注意：订单到达 PaymentAuthorized 后 active=false，不能用 order.active 判断
     */
    async settleOrderPayment(ctx, orderCode, expectedAmountCents) {
        var _a, _b, _c;
        // 回调域名解析出的渠道未必是下单渠道（如 t1 站点回调落 www.youshop.cn 时回退默认渠道），
        // 而 OrderService.findOne 会按 ctx 渠道过滤 → 查不到单，微信已扣款却不结单。
        // 故先全局按 code 取单和它所属渠道，再切到该渠道 ctx 去查单/结算。
        const base = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { code: orderCode },
            relations: ['channels'],
        });
        if (!base) {
            core_1.Logger.error(`settleOrderPayment: order ${orderCode} not found (any channel)`, constants_1.loggerCtx);
            throw new Error(`order ${orderCode} not found`);
        }
        const orderChannel = (_b = (_a = base.channels) === null || _a === void 0 ? void 0 : _a.find(c => Number(c.id) === Number(ctx.channelId))) !== null && _b !== void 0 ? _b : (_c = base.channels) === null || _c === void 0 ? void 0 : _c[0];
        const orderCtx = orderChannel && Number(orderChannel.id) !== Number(ctx.channelId)
            ? new core_1.RequestContext({
                apiType: 'admin',
                channel: orderChannel,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            })
            : ctx;
        const order = await this.orderService.findOneByCode(orderCtx, orderCode, ['payments']);
        if (!order) {
            core_1.Logger.error(`settleOrderPayment: order ${orderCode} not found in channel ${orderCtx.channelId}`, constants_1.loggerCtx);
            throw new Error(`order ${orderCode} not found in channel ${orderCtx.channelId}`);
        }
        const payments = order.payments || [];
        const authorized = payments.filter(p => p.state === 'Authorized');
        // 金额校验：仅对待结算支付校验（已全部 Settled 的重复通知应直接幂等跳过，
        // 不能因无 Authorized 支付而误判失败、导致平台无限重投）
        if (expectedAmountCents != undefined && authorized.length > 0) {
            if (!authorized.some(p => Number(p.amount) === expectedAmountCents)) {
                const amounts = authorized.map(p => `${p.id}:${p.amount}`).join(', ');
                throw new Error(`amount mismatch for order ${orderCode}: notify=${expectedAmountCents}, authorized=[${amounts}]`);
            }
        }
        let settledCount = 0;
        for (const payment of payments) {
            // 幂等：已 Settled / 已取消等非 Authorized 状态直接跳过，重复通知不会重复结算
            if (payment.state !== 'Authorized') {
                continue;
            }
            const result = await this.orderService.settlePayment(orderCtx, payment.id);
            if ((0, core_1.isGraphQlErrorResult)(result)) {
                // 并发重复通知：另一路已抢先结算成功时重查状态，已 Settled 视为幂等成功
                const fresh = await this.connection
                    .getRepository(orderCtx, core_1.Payment)
                    .findOne({ where: { id: payment.id } });
                if ((fresh === null || fresh === void 0 ? void 0 : fresh.state) === 'Settled') {
                    core_1.Logger.info(`Payment ${payment.id} already settled by concurrent notify, skip (outTradeNo=${orderCode})`, constants_1.loggerCtx);
                    continue;
                }
                throw new Error(`settlePayment failed for order ${orderCode} payment ${payment.id}: ${result.message}`);
            }
            settledCount++;
            core_1.Logger.info(`Settled payment ${payment.id} for order ${orderCode}`, constants_1.loggerCtx);
        }
        if (settledCount === 0) {
            core_1.Logger.info(`No Authorized payment to settle for order ${orderCode} (idempotent skip)`, constants_1.loggerCtx);
        }
    }
    /**
     * 构造 WxPay 实例用于通知回调中验签解密。
     * 凭证路由（分端分支付方案）：
     * 1. Host 命中 options.callbackMethodMap → 直接用该 PaymentMethod 的 args
     *    （同一 Host 下多个 method 共用商户时 apiKey 相同，任取其一即可解密验签）
     * 2. 未命中 → 渠道 override（payConfig.wechatpayJson）+ code='wechatpay' 的 PaymentMethod args
     */
    async buildWxPay(ctx, host) {
        var _a, _b, _c, _d, _e, _f;
        const mapCode = (_b = (_a = this.options) === null || _a === void 0 ? void 0 : _a.callbackMethodMap) === null || _b === void 0 ? void 0 : _b[host];
        const pms = await this.paymentMethodService.findAll(ctx);
        const mapped = mapCode ? pms.items.find(p => p.code === mapCode) : undefined;
        const mappedApiKey = ((_e = (_d = (_c = mapped === null || mapped === void 0 ? void 0 : mapped.handler) === null || _c === void 0 ? void 0 : _c.args) === null || _d === void 0 ? void 0 : _d.find(a => a.name === 'apiKey')) === null || _e === void 0 ? void 0 : _e.value) || '';
        // 映射到的方法若没有商户凭证（如仅作占位、未填 key 的 wechatpay-xxx），不能只用它验签：
        // apiKey 为空会让验签恒失败、回调 401（微信重试后仍失败 → 已付款但不结单/不发券）。
        // 此时回退到「渠道 override + wechatpay」这条既有主链。
        const useMapped = !!mapped && !!mappedApiKey;
        let override = null;
        let methodCode = 'wechatpay';
        if (useMapped) {
            methodCode = mapCode;
        }
        else {
            override = (0, payment_config_1.getPaymentOverride)(ctx, 'wechatpay');
            if (mapCode && !useMapped) {
                core_1.Logger.warn(`callbackMethodMap[${host}]=${mapCode} 缺少商户凭证，回退 wechatpay 验签`, constants_1.loggerCtx);
            }
        }
        const pm = pms.items.find(p => p.code === methodCode);
        const args = ((_f = pm === null || pm === void 0 ? void 0 : pm.handler) === null || _f === void 0 ? void 0 : _f.args) || [];
        const getArg = (name) => { var _a; return ((_a = args.find(a => a.name === name)) === null || _a === void 0 ? void 0 : _a.value) || ''; };
        const apiKey = (override === null || override === void 0 ? void 0 : override.apiKey) || getArg('apiKey');
        const appId = (override === null || override === void 0 ? void 0 : override.appId) || getArg('appId');
        const mchId = (override === null || override === void 0 ? void 0 : override.mchId) || getArg('mchId');
        const pay = new wechatpay_node_v3_1.default({
            appid: appId,
            mchid: mchId,
            publicKey: Buffer.from((override === null || override === void 0 ? void 0 : override.publicKey) || getArg('publicKey')),
            privateKey: Buffer.from((override === null || override === void 0 ? void 0 : override.privateKey) || getArg('privateKey')),
            key: apiKey,
            serial_no: (override === null || override === void 0 ? void 0 : override.serialNo) || getArg('serialNo'),
        });
        return { pay, apiKey, appId, mchId };
    }
    /**
     * 生产环境：V3 通知验签 + AES-GCM 解密
     */
    async notify(req, res, body) {
        var _a;
        try {
            const { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': signature, 'wechatpay-serial': serial, } = req.headers;
            const resource = body === null || body === void 0 ? void 0 : body.resource;
            if (!resource) {
                return res.status(400).json({ code: 'FAIL', message: 'missing resource' });
            }
            const ctx = await this.callbackCtx(req);
            const host = req.hostname || req.headers.host || '';
            const { pay, apiKey, appId, mchId } = await this.buildWxPay(ctx, host);
            // 1. 验签（verifySign 返回 Promise，必须 await，否则恒为真 = 验签失效）
            const bodyStr = JSON.stringify(body);
            const verified = await pay.verifySign({
                timestamp,
                nonce,
                body: bodyStr,
                serial,
                signature,
                apiSecret: apiKey,
            });
            if (!verified) {
                core_1.Logger.warn('WeChat Pay notify signature verification failed', constants_1.loggerCtx);
                return res.status(401).json({ code: 'FAIL', message: '签名验证失败' });
            }
            // 2. AES-GCM 解密
            const decrypted = pay.decipher_gcm(resource.ciphertext, resource.associated_data, resource.nonce);
            const outTradeNo = decrypted === null || decrypted === void 0 ? void 0 : decrypted.out_trade_no;
            const transactionId = decrypted === null || decrypted === void 0 ? void 0 : decrypted.transaction_id;
            core_1.Logger.info(`WeChat Pay trade success: ${outTradeNo}, txId: ${transactionId}`, constants_1.loggerCtx);
            // 3. 处理支付结果
            if ((body === null || body === void 0 ? void 0 : body.event_type) === 'TRANSACTION.SUCCESS' && outTradeNo) {
                // 商户归属校验：通知的 appid/mchid 必须与验签所用凭证一致
                if ((decrypted.appid && decrypted.appid !== appId) ||
                    (decrypted.mchid && decrypted.mchid !== mchId)) {
                    throw new Error(`merchant mismatch for ${outTradeNo}: appid=${String(decrypted.appid)}/${appId}, mchid=${String(decrypted.mchid)}/${mchId}`);
                }
                const amountTotal = (_a = decrypted.amount) === null || _a === void 0 ? void 0 : _a.total;
                if (typeof amountTotal !== 'number' || !Number.isFinite(amountTotal)) {
                    throw new Error(`missing amount in wechat notify for ${outTradeNo}`);
                }
                await this.routeSettlement(ctx, outTradeNo, transactionId || '', amountTotal);
            }
            res.status(200).json({ code: 'SUCCESS', message: 'OK' });
        }
        catch (e) {
            core_1.Logger.error(`WeChat Pay notify error: ${e.message}`, constants_1.loggerCtx);
            res.status(500).json({ code: 'FAIL', message: e.message });
        }
    }
    /**
     * Dev Bypass: 模拟微信支付页面
     * 安全门禁：控制器注册是静态装饰器元数据，无法按运行时 options 省略路由，
     * 故仅在显式开启 devBypass 时可用，否则返回 404（不暴露该端点存在）。
     */
    getDevPayPage(req, res) {
        var _a;
        if (!((_a = this.options) === null || _a === void 0 ? void 0 : _a.devBypass)) {
            return res.status(404).send('Not Found');
        }
        const outTradeNo = req.query.outTradeNo;
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
    async devNotify(req, res) {
        var _a;
        if (!((_a = this.options) === null || _a === void 0 ? void 0 : _a.devBypass)) {
            return res.status(404).json({ code: 'FAIL', message: 'Not Found' });
        }
        const outTradeNo = req.query.outTradeNo;
        try {
            if (!outTradeNo) {
                return res.status(400).json({ code: 'FAIL', message: 'missing outTradeNo' });
            }
            await this.routeSettlement(await this.callbackCtx(req), outTradeNo, 'DEV-TX');
            res.status(200).json({ code: 'SUCCESS', message: 'OK' });
        }
        catch (e) {
            core_1.Logger.error(`WeChat Pay dev-notify error: ${e.message}`, constants_1.loggerCtx);
            res.status(500).json({ code: 'FAIL', message: e.message });
        }
    }
};
exports.WechatpayController = WechatpayController;
__decorate([
    (0, common_1.Post)('notify'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], WechatpayController.prototype, "notify", null);
__decorate([
    (0, common_1.Get)('dev-pay'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WechatpayController.prototype, "getDevPayPage", null);
__decorate([
    (0, common_1.Post)('dev-notify'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WechatpayController.prototype, "devNotify", null);
exports.WechatpayController = WechatpayController = __decorate([
    (0, common_1.Controller)('wechatpay'),
    __param(0, (0, common_1.Inject)(constants_1.WECHATPAY_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, core_1.OrderService,
        core_1.ChannelService,
        core_1.TransactionalConnection,
        core_1.PaymentMethodService,
        core_1.RequestContextService,
        wechatpay_settlement_1.WechatpaySettlementRegistry])
], WechatpayController);
//# sourceMappingURL=wechatpay.controller.js.map