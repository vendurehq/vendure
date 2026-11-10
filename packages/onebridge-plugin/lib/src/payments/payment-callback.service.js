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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OnebridgePaymentCallbackService = void 0;
exports.paidIdempotencyKey = paidIdempotencyKey;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const entities_1 = require("../entities");
const errors_1 = require("../errors");
const i18n_1 = require("../i18n");
const types_1 = require("../types");
/** paid 节点幂等键：调用方显式传入优先，否则按渠道+订单号派生（CT-05 重复回调口径） */
function paidIdempotencyKey(channelToken, orderCode, override) {
    const explicit = override === null || override === void 0 ? void 0 : override.trim();
    return explicit || `payment:${channelToken}:${orderCode}:paid`;
}
/**
 * 韩国 PG 回调处理（CT-05 一期桩）。
 * 幂等口径：同一订单的 paid 节点只写一次，幂等键优先取入参 idempotencyKey，
 * 否则用 `payment:{channelToken}:{orderCode}:paid`；重复回调返回成功 +
 * PAYMENT_CALLBACK_DUPLICATE，并写一条结构化审计日志（一期不新建审计表）。
 */
let OnebridgePaymentCallbackService = class OnebridgePaymentCallbackService {
    constructor(connection, orderService) {
        this.connection = connection;
        this.orderService = orderService;
    }
    async handleKoreaPg(ctx, payload) {
        var _a, _b;
        const orderCode = (_a = payload.orderCode) === null || _a === void 0 ? void 0 : _a.trim();
        if (!orderCode)
            throw new core_1.UserInputError('orderCode is required');
        if (!((_b = payload.transactionId) === null || _b === void 0 ? void 0 : _b.trim()))
            throw new core_1.UserInputError('transactionId is required');
        if (payload.status !== 'paid') {
            throw new core_1.UserInputError(`Unsupported callback status: ${payload.status}（一期仅处理 paid）`);
        }
        const order = await this.orderService.findOneByCode(ctx, orderCode, ['payments']);
        if (!order)
            throw errors_1.Errors.orderNotFound(orderCode);
        if (payload.currencyCode && payload.currencyCode !== order.currencyCode) {
            throw errors_1.Errors.currencyMismatch(order.currencyCode, payload.currencyCode);
        }
        if (payload.amount != null && payload.amount !== order.totalWithTax) {
            throw new core_1.UserInputError(`Amount mismatch for ${orderCode}: order ${order.totalWithTax}, callback ${payload.amount}`);
        }
        const stageRepo = this.connection.getRepository(ctx, entities_1.StageEvent);
        const idempotencyKey = paidIdempotencyKey(ctx.channel.token, orderCode, payload.idempotencyKey);
        const paidNode = await stageRepo.findOne({
            where: [
                { idempotencyKey },
                { ownerType: 'order', ownerCode: orderCode, stage: 'wait_pay' },
            ],
        });
        if (paidNode) {
            this.auditDuplicate(ctx, orderCode, payload, idempotencyKey);
            return {
                success: true,
                duplicate: true,
                code: types_1.ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_DUPLICATE,
                orderCode,
            };
        }
        await this.settleAuthorizedPayments(ctx, order);
        const copy = (0, i18n_1.timelineNodeCopy)('net', 1, 'zh');
        await stageRepo.save(new entities_1.StageEvent({
            ownerType: 'order',
            ownerCode: orderCode,
            // 14 态冻结、无 paid 态：支付完成对应 net 时间轴 index 1，与 wait_pay 的 stageIndex 对齐
            stage: 'wait_pay',
            // TODO(韩文待定稿)：韩文缺失，按约定回落中文占位
            titleKr: copy.title,
            titleCn: copy.title,
            descKr: null,
            descCn: copy.desc,
            state: 'done',
            occurredAt: new Date(),
            operator: 'korea-pg-callback',
            idempotencyKey,
        }));
        await this.finalizeAfterPayment(ctx, orderCode);
        core_1.Logger.info(`korea-pg callback paid: order=${orderCode} transaction=${payload.transactionId} channel=${ctx.channel.token}`, types_1.loggerCtx);
        return { success: true, duplicate: false, code: null, orderCode };
    }
    /** 结算该订单下仍处于 Authorized 的 korea-pg 支付；无支付记录时保持时间轴落账（桩期口径） */
    async settleAuthorizedPayments(ctx, order) {
        var _a;
        const payments = ((_a = order.payments) !== null && _a !== void 0 ? _a : []);
        for (const payment of payments) {
            if (payment.state === 'Authorized' && payment.method === 'korea-pg') {
                await this.orderService.settlePayment(ctx, payment.id);
            }
        }
    }
    /**
     * 支付成功收尾（A4）：
     * 1) net 线付款完成后 wait_pay → shipping（demo/data.js 阶段流转）；其他业务线不动阶段；
     * 2) 无论阶段是否变化都显式刷新 updatedAt —— 之前阶段非 wait_pay 时直接 return，
     *    支付成功后 updatedAt 仍是下单时间，C 端据此判断「无新动态」。
     */
    async finalizeAfterPayment(ctx, orderCode) {
        var _a;
        const order = await this.orderService.findOneByCode(ctx, orderCode);
        if (!order)
            return;
        const customFields = Object.assign({}, ((_a = order.customFields) !== null && _a !== void 0 ? _a : {}));
        if (!customFields.crossBorderStage || customFields.crossBorderStage === 'wait_pay') {
            customFields.crossBorderStage = 'shipping';
        }
        await this.connection.getRepository(ctx, core_1.Order).update(order.id, {
            customFields,
            updatedAt: new Date(),
        });
    }
    auditDuplicate(ctx, orderCode, payload, idempotencyKey) {
        core_1.Logger.warn(`${types_1.ONEBRIDGE_ERROR_CODES.PAYMENT_CALLBACK_DUPLICATE} ${JSON.stringify({
            orderCode,
            transactionId: payload.transactionId,
            idempotencyKey,
            channelToken: ctx.channel.token,
        })}`, types_1.loggerCtx);
    }
};
exports.OnebridgePaymentCallbackService = OnebridgePaymentCallbackService;
exports.OnebridgePaymentCallbackService = OnebridgePaymentCallbackService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.OrderService])
], OnebridgePaymentCallbackService);
//# sourceMappingURL=payment-callback.service.js.map