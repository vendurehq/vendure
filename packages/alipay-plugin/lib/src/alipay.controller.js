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
exports.AlipayController = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const alipay_sdk_1 = require("alipay-sdk");
let AlipayController = class AlipayController {
    constructor(options, orderService, channelService, connection) {
        this.options = options;
        this.orderService = orderService;
        this.channelService = channelService;
        this.connection = connection;
    }
    /**
     * 结算订单支付。失败必须抛错（外层返回 failure）触发支付宝重投，避免「已扣款不结单」；
     * 已结算/非 Authorized 的支付直接跳过，重复通知天然幂等。
     */
    async settleOrderPayment(outTradeNo) {
        var _a, _b, _c;
        const channel = await this.channelService.getDefaultChannel();
        const ctx = new core_1.RequestContext({
            apiType: 'admin',
            channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
        // 默认渠道未必是下单渠道：先全局按 code 取单，再切到订单所属渠道结算
        const base = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { code: outTradeNo },
            relations: ['channels'],
        });
        if (!base) {
            core_1.Logger.error(`Alipay settle: order ${outTradeNo} not found (any channel)`, constants_1.loggerCtx);
            throw new Error(`order ${outTradeNo} not found`);
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
        const order = await this.orderService.findOneByCode(orderCtx, outTradeNo, ['payments']);
        if (!order) {
            core_1.Logger.error(`Alipay settle: order ${outTradeNo} not found in channel ${orderCtx.channelId}`, constants_1.loggerCtx);
            throw new Error(`order ${outTradeNo} not found in channel ${orderCtx.channelId}`);
        }
        let settledCount = 0;
        for (const payment of order.payments || []) {
            // 幂等：已 Settled / 已取消等非 Authorized 状态直接跳过
            if (payment.state !== 'Authorized')
                continue;
            const result = await this.orderService.settlePayment(orderCtx, payment.id);
            if ((0, core_1.isGraphQlErrorResult)(result)) {
                // 并发重复通知：另一路已抢先结算成功时重查状态，已 Settled 视为幂等成功
                const fresh = await this.connection
                    .getRepository(orderCtx, core_1.Payment)
                    .findOne({ where: { id: payment.id } });
                if ((fresh === null || fresh === void 0 ? void 0 : fresh.state) === 'Settled') {
                    core_1.Logger.info(`Payment ${payment.id} already settled by concurrent notify, skip (outTradeNo=${outTradeNo})`, constants_1.loggerCtx);
                    continue;
                }
                throw new Error(`settlePayment failed for order ${outTradeNo} payment ${payment.id}: ${result.message}`);
            }
            settledCount++;
            core_1.Logger.info(`Settled payment ${String(payment.id)} for order ${String(outTradeNo)}`, constants_1.loggerCtx);
        }
        if (settledCount === 0) {
            core_1.Logger.info(`No Authorized payment to settle for order ${outTradeNo} (idempotent skip)`, constants_1.loggerCtx);
        }
    }
    async notify(req, res, body) {
        let outTradeNo;
        try {
            const sign = body.sign;
            const signType = body.sign_type || 'RSA2';
            const alipaySdk = new alipay_sdk_1.AlipaySdk({
                appId: body.app_id,
                privateKey: '',
                alipayPublicKey: this.options.alipayPublicKey,
                signType,
            });
            const verified = alipaySdk.checkNotifySign(body);
            if (!verified) {
                core_1.Logger.warn('Alipay notify signature verification failed', constants_1.loggerCtx);
                res.send('fail');
                return;
            }
            const tradeStatus = body.trade_status;
            outTradeNo = body.out_trade_no;
            if (tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED') {
                core_1.Logger.info(`Alipay trade success: ${String(outTradeNo)}, txId: ${String(body.trade_no)}`, constants_1.loggerCtx);
                await this.settleOrderPayment(String(outTradeNo));
            }
            // 支付宝：只有返回 success 才会停止重投
            res.send('success');
        }
        catch (e) {
            core_1.Logger.error(`Alipay notify error (outTradeNo=${String(outTradeNo)}): ${String(e.message)}`, constants_1.loggerCtx);
            res.send('fail');
        }
    }
};
exports.AlipayController = AlipayController;
__decorate([
    (0, common_1.Post)('notify'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AlipayController.prototype, "notify", null);
exports.AlipayController = AlipayController = __decorate([
    (0, common_1.Controller)('alipay'),
    __param(0, (0, common_1.Inject)(constants_1.ALIPAY_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, core_1.OrderService,
        core_1.ChannelService,
        core_1.TransactionalConnection])
], AlipayController);
//# sourceMappingURL=alipay.controller.js.map