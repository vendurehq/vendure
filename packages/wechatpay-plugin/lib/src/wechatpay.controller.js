"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const crypto = __importStar(require("crypto"));
const wechatpay_node_v3_1 = __importDefault(require("wechatpay-node-v3"));
const core_1 = require("@vendure/core");
// 断开循环依赖（同 wechatpay-handler.ts 注释）：从叶子模块导入，不经 cjk 主入口
const payment_config_1 = require("@vendure/cjk-plugin/lib/src/payment/payment-config");
const constants_1 = require("./constants");
const wechatpay_settlement_1 = require("./wechatpay-settlement");
/** 可预期的回调拒绝：统一映射到微信可识别的失败响应 + 结构化日志 */
class NotifyReject extends Error {
    constructor(reason, status = 500, fields = {}) {
        super(reason);
        this.reason = reason;
        this.status = status;
        this.fields = fields;
    }
}
let WechatpayController = class WechatpayController {
    constructor(options, orderService, channelService, connection, requestContextService, settlementRegistry) {
        this.options = options;
        this.orderService = orderService;
        this.channelService = channelService;
        this.connection = connection;
        this.requestContextService = requestContextService;
        this.settlementRegistry = settlementRegistry;
    }
    ctxFor(channel) {
        return new core_1.RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }
    /** 回调结构化日志：单行 JSON，禁止输出私钥/apiKey/密文 */
    logNotify(level, reason, fields) {
        const payload = JSON.stringify(Object.assign({ scope: 'wechatpay.notify', reason }, fields));
        if (level === 'error') {
            core_1.Logger.error(payload, constants_1.loggerCtx);
        }
        else if (level === 'warn') {
            core_1.Logger.warn(payload, constants_1.loggerCtx);
        }
        else {
            core_1.Logger.info(payload, constants_1.loggerCtx);
        }
    }
    /**
     * 收集所有可用商户凭证（与域名无关）。
     * 微信 v3 回调的 out_trade_no 在密文里，解密前无法反查订单，
     * 故先枚举凭证并用 GCM 认证做鉴别（错误密钥必然解密失败），
     * 解密成功后再用 out_trade_no 反查 order → channel 做最终裁决。
     */
    async collectCredentials(baseCtx) {
        var _a, _b, _c;
        const out = [];
        // 1) 渠道级覆盖：channel.customFields.payConfig.wechatpayJson
        const channels = await this.connection.getRepository(baseCtx, core_1.Channel).find();
        for (const channel of channels) {
            const override = (0, payment_config_1.getPaymentOverride)(this.ctxFor(channel), 'wechatpay');
            if (!(override === null || override === void 0 ? void 0 : override.apiKey) || !override.appId || !override.mchId)
                continue;
            out.push({
                channelId: Number(channel.id),
                source: 'channelOverride',
                appId: override.appId,
                mchId: override.mchId,
                apiKey: override.apiKey,
                publicKey: override.publicKey || '',
                privateKey: override.privateKey || '',
                serialNo: override.serialNo || '',
            });
        }
        // 2) PaymentMethod 级凭证：handler.args 里的商户参数 + 其绑定渠道
        const methods = await this.connection
            .getRepository(baseCtx, core_1.PaymentMethod)
            .find({ relations: ['channels'] });
        for (const pm of methods) {
            let handler = pm.handler;
            if (typeof handler === 'string') {
                try {
                    handler = JSON.parse(handler);
                }
                catch (_d) {
                    continue;
                }
            }
            if (!String((_a = handler === null || handler === void 0 ? void 0 : handler.code) !== null && _a !== void 0 ? _a : '').includes('wechat'))
                continue;
            const args = (_b = handler === null || handler === void 0 ? void 0 : handler.args) !== null && _b !== void 0 ? _b : [];
            const getArg = (name) => { var _a; return ((_a = args.find(a => a.name === name)) === null || _a === void 0 ? void 0 : _a.value) || ''; };
            const appId = getArg('appId');
            const mchId = getArg('mchId');
            const apiKey = getArg('apiKey');
            if (!appId || !mchId || !apiKey)
                continue;
            const isWechatHandler = handler.code === 'wechatpay';
            if (!isWechatHandler)
                continue;
            for (const channel of (_c = pm.channels) !== null && _c !== void 0 ? _c : []) {
                out.push({
                    channelId: Number(channel.id),
                    source: 'paymentMethod',
                    methodCode: pm.code,
                    appId,
                    mchId,
                    apiKey,
                    publicKey: getArg('publicKey'),
                    privateKey: getArg('privateKey'),
                    serialNo: getArg('serialNo'),
                });
            }
        }
        // 去重（同一渠道同一套凭证只试一次）
        const seen = new Set();
        return out.filter(c => {
            var _a;
            const key = [c.channelId, c.source, (_a = c.methodCode) !== null && _a !== void 0 ? _a : '', c.appId, c.mchId, c.serialNo].join('|');
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    buildWxPay(cred) {
        return new wechatpay_node_v3_1.default({
            appid: cred.appId,
            mchid: cred.mchId,
            publicKey: Buffer.from(cred.publicKey),
            privateKey: Buffer.from(cred.privateKey),
            key: cred.apiKey,
            serial_no: cred.serialNo,
        });
    }
    /**
     * V3 回调验签。两种商户安全模式都要支持：
     * 1) 微信支付公钥模式：商户号已无平台证书（/v3/certificates 返回 RESOURCE_NOT_EXISTS），
     *    回调头 Wechatpay-Serial 为 PUB_KEY_ID_xxx，直接用渠道配置的微信支付公钥做 RSA-SHA256 验签；
     * 2) 平台证书模式：用 SDK 拉取平台证书验签（publicKey 非平台证书时自然落到这里）。
     * 验签失败或异常一律返回 false，由上层计入「凭证不匹配」分支。
     */
    async verifyNotifySignature(cred, pay, params) {
        const message = `${params.timestamp}\n${params.nonce}\n${params.body}\n`;
        if (cred.publicKey && cred.publicKey.includes('BEGIN')) {
            try {
                const ok = crypto
                    .createVerify('RSA-SHA256')
                    .update(message)
                    .verify(cred.publicKey, params.signature, 'base64');
                if (ok)
                    return true;
            }
            catch (_a) {
                // 交由平台证书模式兜底
            }
        }
        try {
            return await pay.verifySign({
                timestamp: params.timestamp,
                nonce: params.nonce,
                body: params.body,
                serial: params.serial,
                signature: params.signature,
                apiSecret: cred.apiKey,
            });
        }
        catch (_b) {
            return false;
        }
    }
    /**
     * 由 out_trade_no 反查渠道（不做任何 Host 解析）。
     * 结算类前缀（CS-/BP- 等）优先走注册器；否则按全局订单号查 order.channels，
     * 并与「凭证试解成功的渠道集合」取交集，交集为空即拒绝（防跨渠道结算）。
     */
    async resolveChannelForOutTradeNo(baseCtx, outTradeNo, matchedChannelIds) {
        var _a;
        const uniqueMatched = Array.from(new Set(matchedChannelIds));
        const settlement = this.settlementRegistry.find(outTradeNo);
        if (settlement) {
            if (uniqueMatched.length !== 1) {
                throw new NotifyReject('AMBIGUOUS_CHANNEL', 500, {
                    outTradeNo,
                    registryPrefix: settlement.prefix,
                    matchedChannelIds: uniqueMatched,
                });
            }
            const channel = await this.channelService.findOne(baseCtx, uniqueMatched[0]);
            if (!channel) {
                throw new NotifyReject('CHANNEL_NOT_FOUND', 500, {
                    outTradeNo,
                    matchedChannelIds: uniqueMatched,
                });
            }
            return channel;
        }
        const order = await this.connection.getRepository(baseCtx, core_1.Order).findOne({
            where: { code: outTradeNo },
            relations: ['channels'],
        });
        if (!order) {
            throw new NotifyReject('ORDER_NOT_FOUND', 500, {
                outTradeNo,
                matchedChannelIds: uniqueMatched,
            });
        }
        const orderChannels = (_a = order.channels) !== null && _a !== void 0 ? _a : [];
        const orderChannelIds = orderChannels.map(c => Number(c.id));
        const intersection = orderChannels.filter(c => uniqueMatched.includes(Number(c.id)));
        if (intersection.length === 0) {
            throw new NotifyReject('CHANNEL_MISMATCH', 500, {
                outTradeNo,
                matchedChannelIds: uniqueMatched,
                orderChannelIds,
            });
        }
        if (intersection.length > 1) {
            // 订单同时挂多个渠道且这些渠道凭证都能解密（共享商户号）：无法唯一判定时不冒险结算
            throw new NotifyReject('AMBIGUOUS_CHANNEL', 500, {
                outTradeNo,
                matchedChannelIds: uniqueMatched,
                orderChannelIds,
            });
        }
        return intersection[0];
    }
    /** 仅用于 dev 端点：按订单号取所属渠道 ctx（回调正式路径不用） */
    async resolveOrderChannelCtx(baseCtx, outTradeNo) {
        var _a;
        const order = await this.connection.getRepository(baseCtx, core_1.Order).findOne({
            where: { code: outTradeNo },
            relations: ['channels'],
        });
        const channel = (_a = order === null || order === void 0 ? void 0 : order.channels) === null || _a === void 0 ? void 0 : _a[0];
        return channel ? this.ctxFor(channel) : null;
    }
    /** 结算路由：非订单前缀（如 CS-/BP-）交给注册的结算器，否则默认结 Vendite Order。
     *  expectedAmountCents：微信回调解密出的金额（分），用于与 Authorized 支付金额比对。 */
    async routeSettlement(ctx, outTradeNo, transactionId, expectedAmountCents, trace = {}) {
        const settlement = this.settlementRegistry.find(outTradeNo);
        if (settlement) {
            await settlement.settle(ctx, outTradeNo, transactionId);
            return;
        }
        await this.settleOrderPayment(ctx, outTradeNo, expectedAmountCents, trace);
    }
    /**
     * 结算订单支付：dev-notify 和 notify 共用
     * 查询 Authorized 状态的支付并调用 settlePayment。
     * 失败必须抛错（由外层返回 500/FAIL），让微信重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，平台重复通知天然幂等。
     * 注意：订单到达 PaymentAuthorized 后 active=false，不能用 order.active 判断
     */
    async settleOrderPayment(ctx, orderCode, expectedAmountCents, trace = {}) {
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['payments']);
        if (!order) {
            throw new NotifyReject('ORDER_NOT_FOUND', 500, Object.assign(Object.assign({}, trace), { orderCode, channelId: Number(ctx.channelId) }));
        }
        const payments = order.payments || [];
        const authorized = payments.filter(p => p.state === 'Authorized');
        // 金额校验：仅对待结算支付校验（已全部 Settled 的重复通知应直接幂等跳过，
        // 不能因无 Authorized 支付而误判失败、导致平台无限重投）
        if (expectedAmountCents != undefined && authorized.length > 0) {
            if (!authorized.some(p => Number(p.amount) === expectedAmountCents)) {
                throw new NotifyReject('AMOUNT_MISMATCH', 500, Object.assign(Object.assign({}, trace), { orderCode, channelId: Number(ctx.channelId), notifyAmount: expectedAmountCents, authorizedPayments: authorized.map(p => ({ paymentId: p.id, amount: p.amount })) }));
            }
        }
        let settledCount = 0;
        for (const payment of payments) {
            // 幂等：已 Settled / 已取消等非 Authorized 状态直接跳过，重复通知不会重复结算
            if (payment.state !== 'Authorized') {
                continue;
            }
            const result = await this.orderService.settlePayment(ctx, payment.id);
            if ((0, core_1.isGraphQlErrorResult)(result)) {
                // 并发重复通知：另一路已抢先结算成功时重查状态，已 Settled 视为幂等成功
                const fresh = await this.connection
                    .getRepository(ctx, core_1.Payment)
                    .findOne({ where: { id: payment.id } });
                if ((fresh === null || fresh === void 0 ? void 0 : fresh.state) === 'Settled') {
                    this.logNotify('info', 'ALREADY_SETTLED', Object.assign(Object.assign({}, trace), { orderCode, channelId: Number(ctx.channelId), paymentId: payment.id }));
                    continue;
                }
                throw new NotifyReject('SETTLE_FAILED', 500, Object.assign(Object.assign({}, trace), { orderCode, channelId: Number(ctx.channelId), paymentId: payment.id, detail: result.message }));
            }
            settledCount++;
            this.logNotify('info', 'PAYMENT_SETTLED', Object.assign(Object.assign({}, trace), { orderCode, channelId: Number(ctx.channelId), paymentId: payment.id }));
        }
        if (settledCount === 0) {
            this.logNotify('info', 'NO_AUTHORIZED_PAYMENT', Object.assign(Object.assign({}, trace), { orderCode, channelId: Number(ctx.channelId), payments: payments.map(p => ({ paymentId: p.id, state: p.state })) }));
        }
    }
    /**
     * 生产环境：V3 通知验签 + AES-GCM 解密
     * 渠道归属完全由报文内的 out_trade_no 决定（凭证试解 → 订单反查），与回调域名无关。
     */
    async notify(req, res, body) {
        var _a, _b, _c;
        const notifyId = body === null || body === void 0 ? void 0 : body.id;
        const eventType = body === null || body === void 0 ? void 0 : body.event_type;
        try {
            const { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': nonce, 'wechatpay-signature': signature, 'wechatpay-serial': serial, } = req.headers;
            const resource = body === null || body === void 0 ? void 0 : body.resource;
            if (!resource) {
                return res.status(400).json({ code: 'FAIL', message: 'missing resource' });
            }
            if (!timestamp || !nonce || !signature || !serial) {
                this.logNotify('warn', 'MISSING_SIGNATURE_HEADERS', { notifyId, eventType });
                return res.status(400).json({ code: 'FAIL', message: 'missing signature headers' });
            }
            // 微信验签基于原始报文字节；Nest rawBody 未开启时回退到 JSON.stringify（可能因空白差异失败）
            const rawBody = req.rawBody;
            if (!rawBody) {
                this.logNotify('warn', 'RAW_BODY_FALLBACK', { notifyId, eventType });
            }
            const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(body);
            const baseCtx = await this.requestContextService.create({ apiType: 'admin' });
            const credentials = await this.collectCredentials(baseCtx);
            // 逐凭证试验签 + 试解密：验签通过且 GCM 认证成功（错误密钥必然失败）才认定为该渠道
            const matches = [];
            for (const credential of credentials) {
                const pay = this.buildWxPay(credential);
                const verified = await this.verifyNotifySignature(credential, pay, {
                    timestamp,
                    nonce,
                    body: bodyStr,
                    signature,
                    serial,
                });
                if (!verified)
                    continue;
                let decrypted;
                try {
                    decrypted = pay.decipher_gcm(resource.ciphertext, resource.associated_data, resource.nonce);
                }
                catch (_d) {
                    continue;
                }
                // 商户归属校验：报文 appid/mchid 必须与该渠道凭证一致
                if ((decrypted === null || decrypted === void 0 ? void 0 : decrypted.appid) && decrypted.appid !== credential.appId)
                    continue;
                if ((decrypted === null || decrypted === void 0 ? void 0 : decrypted.mchid) && decrypted.mchid !== credential.mchId)
                    continue;
                matches.push({ credential, decrypted });
            }
            if (matches.length === 0) {
                this.logNotify('error', 'NO_CREDENTIAL_MATCH', {
                    notifyId,
                    eventType,
                    platformSerial: serial,
                    candidateCount: credentials.length,
                });
                return res.status(401).json({ code: 'FAIL', message: 'NO_CREDENTIAL_MATCH' });
            }
            const decrypted = matches[0].decrypted;
            const outTradeNo = decrypted === null || decrypted === void 0 ? void 0 : decrypted.out_trade_no;
            const transactionId = (decrypted === null || decrypted === void 0 ? void 0 : decrypted.transaction_id) || '';
            const matchedChannelIds = matches.map(m => m.credential.channelId);
            const trace = { notifyId, outTradeNo, transactionId };
            if (!outTradeNo) {
                throw new NotifyReject('MISSING_OUT_TRADE_NO', 500, { notifyId, eventType });
            }
            // 非支付成功事件（退款等）仅确认收到，不做结算
            if (eventType !== 'TRANSACTION.SUCCESS') {
                this.logNotify('info', 'IGNORED_EVENT', Object.assign(Object.assign({}, trace), { eventType, matchedChannelIds }));
                return res.status(200).json({ code: 'SUCCESS', message: 'OK' });
            }
            if (decrypted.trade_state && decrypted.trade_state !== 'SUCCESS') {
                this.logNotify('info', 'NON_SUCCESS_TRADE_STATE', Object.assign(Object.assign({}, trace), { eventType, tradeState: decrypted.trade_state, matchedChannelIds }));
                return res.status(200).json({ code: 'SUCCESS', message: 'OK' });
            }
            const amountTotal = (_a = decrypted.amount) === null || _a === void 0 ? void 0 : _a.total;
            if (typeof amountTotal !== 'number' || !Number.isFinite(amountTotal)) {
                throw new NotifyReject('MISSING_AMOUNT', 500, Object.assign(Object.assign({}, trace), { eventType }));
            }
            if (((_b = decrypted.amount) === null || _b === void 0 ? void 0 : _b.currency) && decrypted.amount.currency !== 'CNY') {
                throw new NotifyReject('CURRENCY_MISMATCH', 500, Object.assign(Object.assign({}, trace), { currency: decrypted.amount.currency }));
            }
            const channel = await this.resolveChannelForOutTradeNo(baseCtx, outTradeNo, matchedChannelIds);
            const ctx = this.ctxFor(channel);
            this.logNotify('info', 'RESOLVED', Object.assign(Object.assign({}, trace), { eventType, channelId: Number(channel.id), matchedChannelIds, source: matches[0].credential.source, methodCode: matches[0].credential.methodCode, amount: amountTotal }));
            await this.routeSettlement(ctx, outTradeNo, transactionId, amountTotal, Object.assign(Object.assign({}, trace), { channelId: Number(channel.id) }));
            res.status(200).json({ code: 'SUCCESS', message: 'OK' });
        }
        catch (e) {
            if (e instanceof NotifyReject) {
                this.logNotify('error', e.reason, Object.assign({ notifyId, eventType }, e.fields));
                return res.status(e.status).json({ code: 'FAIL', message: e.reason });
            }
            this.logNotify('error', 'INTERNAL_ERROR', { notifyId, eventType, detail: e === null || e === void 0 ? void 0 : e.message });
            return res.status(500).json({ code: 'FAIL', message: (_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : 'ERROR' });
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
        var _a, _b;
        if (!((_a = this.options) === null || _a === void 0 ? void 0 : _a.devBypass)) {
            return res.status(404).json({ code: 'FAIL', message: 'Not Found' });
        }
        const outTradeNo = req.query.outTradeNo;
        try {
            if (!outTradeNo) {
                return res.status(400).json({ code: 'FAIL', message: 'missing outTradeNo' });
            }
            const baseCtx = await this.requestContextService.create({ apiType: 'admin' });
            // dev 端点同样按订单反查渠道，保持与正式回调一致的渠道语义
            const ctx = (_b = (await this.resolveOrderChannelCtx(baseCtx, outTradeNo))) !== null && _b !== void 0 ? _b : baseCtx;
            await this.routeSettlement(ctx, outTradeNo, 'DEV-TX');
            res.status(200).json({ code: 'SUCCESS', message: 'OK' });
        }
        catch (e) {
            if (e instanceof NotifyReject) {
                this.logNotify('error', e.reason, Object.assign({ outTradeNo }, e.fields));
                return res.status(500).json({ code: 'FAIL', message: e.reason });
            }
            this.logNotify('error', 'DEV_NOTIFY_ERROR', { outTradeNo, detail: e === null || e === void 0 ? void 0 : e.message });
            res.status(500).json({ code: 'FAIL', message: e === null || e === void 0 ? void 0 : e.message });
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
        core_1.RequestContextService,
        wechatpay_settlement_1.WechatpaySettlementRegistry])
], WechatpayController);
//# sourceMappingURL=wechatpay.controller.js.map