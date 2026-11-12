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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnebridgePaymentController = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const types_1 = require("../types");
const callback_signature_1 = require("./callback-signature");
const payment_callback_service_1 = require("./payment-callback.service");
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
let OnebridgePaymentController = class OnebridgePaymentController {
    constructor(channelService, callbackService) {
        this.channelService = channelService;
        this.callbackService = callbackService;
    }
    async koreaPgCallback(body, headerToken, signature, timestamp, res) {
        var _a, _b, _c, _d, _e;
        const secret = (_a = process.env.KOREA_PG_CALLBACK_SECRET) !== null && _a !== void 0 ? _a : '';
        const requireSignature = (0, callback_signature_1.isSignatureRequired)();
        if (!secret && requireSignature) {
            core_1.Logger.error(`${types_1.ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_MISSING} KOREA_PG_CALLBACK_SECRET 未配置，生产回调已拒绝`, types_1.loggerCtx);
            return res.status(401).json({
                success: false,
                code: types_1.ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_MISSING,
                message: 'Callback secret is not configured on server',
            });
        }
        if (secret && body) {
            const verdict = (0, callback_signature_1.verifyKoreaPgCallback)(secret, body, signature, timestamp);
            if (!verdict.ok) {
                const code = verdict.code === 'SIGNATURE_MISSING'
                    ? types_1.ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_MISSING
                    : types_1.ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_SIGNATURE_INVALID;
                core_1.Logger.warn(`${code} orderCode=${(_b = body.orderCode) !== null && _b !== void 0 ? _b : '-'} reason=${verdict.code}`, types_1.loggerCtx);
                return res.status(401).json({
                    success: false,
                    code,
                    message: `Callback signature rejected: ${verdict.code}`,
                });
            }
        }
        else if (!secret) {
            core_1.Logger.warn('korea-pg callback 未配置 KOREA_PG_CALLBACK_SECRET，按非生产环境放行（生产必须配置）', types_1.loggerCtx);
        }
        const token = ((_c = body === null || body === void 0 ? void 0 : body.channelToken) === null || _c === void 0 ? void 0 : _c.trim()) || (headerToken === null || headerToken === void 0 ? void 0 : headerToken.trim()) || undefined;
        const channel = token
            ? await this.channelService.getChannelFromToken(token).catch(() => null)
            : await this.channelService.getDefaultChannel().catch(() => null);
        if (!channel) {
            return res.status(400).json({
                success: false,
                code: types_1.ONEBRIDGE_ERROR_CODES.CHANNEL_NOT_RESOLVED,
                message: `Channel not resolved: ${token !== null && token !== void 0 ? token : '<default>'}`,
            });
        }
        const ctx = new core_1.RequestContext({
            apiType: 'shop',
            channel,
            isAuthorized: false,
            authorizedAsOwnerOnly: false,
        });
        try {
            const result = await this.callbackService.handleKoreaPg(ctx, body);
            return res.status(200).json(result);
        }
        catch (e) {
            core_1.Logger.warn(`korea-pg callback rejected: ${e === null || e === void 0 ? void 0 : e.message}`, types_1.loggerCtx);
            return res.status(400).json({
                success: false,
                code: (_d = e === null || e === void 0 ? void 0 : e.code) !== null && _d !== void 0 ? _d : 'PAYMENT_CALLBACK_INVALID',
                message: (_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : 'Invalid callback payload',
            });
        }
    }
};
exports.OnebridgePaymentController = OnebridgePaymentController;
__decorate([
    (0, common_1.Post)('korea-pg/callback'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('vendure-token')),
    __param(2, (0, common_1.Headers)(callback_signature_1.KOREA_PG_SIGNATURE_HEADER)),
    __param(3, (0, common_1.Headers)(callback_signature_1.KOREA_PG_TIMESTAMP_HEADER)),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OnebridgePaymentController.prototype, "koreaPgCallback", null);
exports.OnebridgePaymentController = OnebridgePaymentController = __decorate([
    (0, common_1.Controller)('onebridge/payments'),
    __metadata("design:paramtypes", [core_1.ChannelService,
        payment_callback_service_1.OnebridgePaymentCallbackService])
], OnebridgePaymentController);
//# sourceMappingURL=payment.controller.js.map