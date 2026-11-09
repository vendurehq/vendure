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
const payment_callback_service_1 = require("./payment-callback.service");
/**
 * 韩国 PG 异步回调入口（CT-05 一期桩）。
 * 路径：POST /onebridge/payments/korea-pg/callback
 * 渠道解析：body.channelToken → 请求头 vendure-token → 默认渠道。
 * 响应契约（固定，便于 PG 侧对接）：200 已处理/重复；400 参数或订单校验失败，body 带 code。
 * TODO(真实 PG)：验签（PG 公钥/摘要）与重放窗口校验；一期桩不校验签名。
 */
let OnebridgePaymentController = class OnebridgePaymentController {
    constructor(channelService, callbackService) {
        this.channelService = channelService;
        this.callbackService = callbackService;
    }
    async koreaPgCallback(body, headerToken, res) {
        var _a, _b, _c;
        const token = ((_a = body === null || body === void 0 ? void 0 : body.channelToken) === null || _a === void 0 ? void 0 : _a.trim()) || (headerToken === null || headerToken === void 0 ? void 0 : headerToken.trim()) || undefined;
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
                code: (_b = e === null || e === void 0 ? void 0 : e.code) !== null && _b !== void 0 ? _b : 'PAYMENT_CALLBACK_INVALID',
                message: (_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : 'Invalid callback payload',
            });
        }
    }
};
exports.OnebridgePaymentController = OnebridgePaymentController;
__decorate([
    (0, common_1.Post)('korea-pg/callback'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)('vendure-token')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], OnebridgePaymentController.prototype, "koreaPgCallback", null);
exports.OnebridgePaymentController = OnebridgePaymentController = __decorate([
    (0, common_1.Controller)('onebridge/payments'),
    __metadata("design:paramtypes", [core_1.ChannelService,
        payment_callback_service_1.OnebridgePaymentCallbackService])
], OnebridgePaymentController);
//# sourceMappingURL=payment.controller.js.map