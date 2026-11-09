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
exports.CodCollectionService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const cod_receipt_entities_1 = require("./cod-receipt.entities");
const COD_PAYMENT_CODE = 'cash-on-delivery';
const loggerCtx = 'CodCollection';
/**
 * COD 现金收款台账服务。
 *
 * 原则：先有收款记录，才能记载退款记录。骑手送达 / 商家柜台确认收款时登记一笔
 * confirmed 收款，同时把对应的 COD 授权支付置为 Settled；退款侧（阶段 3）只认 confirmed 收款。
 */
let CodCollectionService = class CodCollectionService {
    constructor(connection, orderService) {
        this.connection = connection;
        this.orderService = orderService;
    }
    /** 本单 COD 支付（方法 code = cash-on-delivery） */
    async codPayments(ctx, orderId) {
        return this.connection
            .getRepository(ctx, core_1.Payment)
            .createQueryBuilder('p')
            .innerJoin('p.order', 'o')
            .where('o.id = :orderId', { orderId })
            .getMany();
    }
    /** 是否还有待收 COD 支付（骑手送达前用于「实收金额必填」判定） */
    async requiresCash(ctx, orderId) {
        const payments = await this.codPayments(ctx, orderId);
        return payments.some(p => p.state === 'Authorized');
    }
    /**
     * 登记一笔 COD 收款并结算对应支付。
     * 幂等：同一支付 + 同一环节 + 同一幂等键重复提交返回原记录；已有 confirmed 收款但幂等键不同则拒绝。
     */
    async register(ctx, orderId, input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const amount = Math.round(Number(input.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new core_1.UserInputError('收款金额必填且必须为正整数（单位：分）');
        }
        if (!input.source) {
            throw new core_1.UserInputError('收款来源必填');
        }
        if (input.source === 'admin_manual' && !String((_a = input.voucherNo) !== null && _a !== void 0 ? _a : '').trim()) {
            throw new core_1.UserInputError('后台人工补录必须填写凭证号');
        }
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new core_1.UserInputError('订单不存在');
        }
        const cod = (await this.codPayments(ctx, orderId)).filter(p => p.method === COD_PAYMENT_CODE);
        if (!cod.length) {
            throw new core_1.UserInputError('该订单不是货到付款（COD）订单');
        }
        const repo = this.connection.getRepository(ctx, cod_receipt_entities_1.CampusCodReceipt);
        let target;
        if (input.paymentId != null) {
            target = cod.find(p => Number(p.id) === Number(input.paymentId));
            if (!target) {
                throw new core_1.UserInputError('指定的支付不是本单 COD 支付');
            }
        }
        else {
            const authorized = cod.filter(p => p.state === 'Authorized');
            if (authorized.length === 1) {
                target = authorized[0];
            }
            else if (authorized.length > 1) {
                throw new core_1.UserInputError('本单存在多笔待收 COD 支付，请指定 paymentId 逐笔确认');
            }
            else {
                // 没有待收支付：已有 confirmed 收款则幂等返回，否则转人工核对
                const existing = await repo.findOne({
                    where: { paymentId: cod[0].id, status: 'confirmed' },
                });
                if (existing)
                    return existing;
                throw new core_1.UserInputError('本单暂无待收 COD 支付（可能已结算），请核对后走后台补录');
            }
        }
        const idempotencyKey = String((_b = input.idempotencyKey) !== null && _b !== void 0 ? _b : '').trim() || `cod:${target.id}:${input.source}`;
        const existingForPayment = await repo.findOne({
            where: { paymentId: target.id, status: 'confirmed' },
        });
        if (existingForPayment) {
            if (existingForPayment.idempotencyKey === idempotencyKey) {
                return existingForPayment; // 重复提交，幂等返回
            }
            throw new core_1.UserInputError('该支付已有 confirmed 收款记录，如需更正请由主管作废后重新登记');
        }
        const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
        if (Number.isNaN(collectedAt.getTime())) {
            throw new core_1.UserInputError('收款时点不合法');
        }
        const entity = repo.create({
            channelId: ctx.channelId,
            orderId: order.id,
            orderCode: (_c = order.code) !== null && _c !== void 0 ? _c : null,
            paymentId: target.id,
            amount,
            currencyCode: 'CNY',
            method: String((_d = input.method) !== null && _d !== void 0 ? _d : 'cash'),
            collectedAt,
            collectedByRole: input.collectedByRole,
            collectedById: (_e = input.collectedById) !== null && _e !== void 0 ? _e : null,
            collectedByName: (_f = input.collectedByName) !== null && _f !== void 0 ? _f : null,
            source: input.source,
            deliveryOrderId: (_g = input.deliveryOrderId) !== null && _g !== void 0 ? _g : null,
            handoverCode: (_h = input.handoverCode) !== null && _h !== void 0 ? _h : null,
            deliveryRecordId: (_j = input.deliveryRecordId) !== null && _j !== void 0 ? _j : null,
            voucherNo: (_k = input.voucherNo) !== null && _k !== void 0 ? _k : null,
            images: (_l = input.images) !== null && _l !== void 0 ? _l : null,
            note: (_m = input.note) !== null && _m !== void 0 ? _m : null,
            status: 'confirmed',
            idempotencyKey,
        });
        let saved;
        try {
            saved = await repo.save(entity);
        }
        catch (e) {
            // 唯一索引并发兜底：另一路已插入则按幂等语义返回
            if ((e === null || e === void 0 ? void 0 : e.code) === '23505' || ((_o = e === null || e === void 0 ? void 0 : e.driverError) === null || _o === void 0 ? void 0 : _o.code) === '23505') {
                const raced = await repo.findOne({
                    where: { paymentId: target.id, status: 'confirmed' },
                });
                if (raced)
                    return raced;
            }
            throw e;
        }
        // 收款已真实发生：先落台账，再结算支付。结算失败不回滚收款记录（钱已收），留痕待补偿。
        await this.settleCodPayment(ctx, target, saved);
        return saved;
    }
    /** 结算 COD 授权支付（失败只告警，不删除已落的收款记录） */
    async settleCodPayment(ctx, payment, receipt) {
        var _a, _b, _c;
        if (payment.state === 'Settled')
            return;
        try {
            const result = await this.orderService.settlePayment(ctx, payment.id);
            if ((result === null || result === void 0 ? void 0 : result.errorCode) || (result === null || result === void 0 ? void 0 : result.state) !== 'Settled') {
                core_1.Logger.warn(`COD 收款 ${receipt.id} 已落库，但支付 ${payment.id} 结算失败：${(_b = (_a = result === null || result === void 0 ? void 0 : result.message) !== null && _a !== void 0 ? _a : result === null || result === void 0 ? void 0 : result.state) !== null && _b !== void 0 ? _b : 'unknown'}`, loggerCtx);
            }
        }
        catch (e) {
            core_1.Logger.error(`COD 收款 ${receipt.id} 已落库，但支付 ${payment.id} 结算异常（需人工核对）：${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, loggerCtx);
        }
    }
    /** 作废收款记录（主管权限）：已关联退款单的不得作废；作废仅纠错台账，不回退已结算支付 */
    async voidReceipt(ctx, receiptId, reason) {
        var _a;
        if (!String(reason !== null && reason !== void 0 ? reason : '').trim()) {
            throw new core_1.UserInputError('作废理由必填');
        }
        const repo = this.connection.getRepository(ctx, cod_receipt_entities_1.CampusCodReceipt);
        const receipt = await repo.findOne({ where: { id: receiptId } });
        if (!receipt) {
            throw new core_1.UserInputError('收款记录不存在');
        }
        if (receipt.status !== 'confirmed') {
            throw new core_1.UserInputError('该收款记录已作废');
        }
        const linked = await this.connection
            .getRepository(ctx, cod_receipt_entities_1.CampusCodRefundLink)
            .count({ where: { receiptId: receipt.id } });
        if (linked > 0) {
            throw new core_1.UserInputError('该收款记录已关联退款单，不能作废');
        }
        receipt.status = 'voided';
        receipt.voidedAt = new Date();
        receipt.voidedById = (_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : null;
        receipt.voidedByName = null;
        receipt.voidReason = String(reason).trim();
        return repo.save(receipt);
    }
    /** 收款台账查询：按订单或全量（最多 200 条，倒序） */
    async list(ctx, orderId) {
        const qb = this.connection
            .getRepository(ctx, cod_receipt_entities_1.CampusCodReceipt)
            .createQueryBuilder('r')
            .orderBy('r.collectedAt', 'DESC')
            .take(200);
        if (orderId != null) {
            qb.andWhere('r.orderId = :orderId', { orderId });
        }
        return qb.getMany();
    }
    /** 指定支付上是否已有 confirmed 收款（退款侧阶段 3 复用） */
    async findConfirmedByPayment(ctx, paymentId) {
        return this.connection
            .getRepository(ctx, cod_receipt_entities_1.CampusCodReceipt)
            .findOne({ where: { paymentId: paymentId, status: 'confirmed' } });
    }
};
exports.CodCollectionService = CodCollectionService;
exports.CodCollectionService = CodCollectionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.OrderService])
], CodCollectionService);
//# sourceMappingURL=cod-receipt.service.js.map