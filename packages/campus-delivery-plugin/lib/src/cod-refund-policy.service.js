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
exports.CodRefundPolicyService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const cod_receipt_entities_1 = require("./cod-receipt.entities");
/**
 * COD 退款闸门：唯一政策 = COD 退款只认 confirmed 收款记录。
 * - 无收款记录：不建退款单（未收款直接取消；已收款待退走人工现金工单）。
 * - 有收款记录：可退上限 = 实收金额 − 已挂非 Failed 退款；建单即 Settled（现金已退），并写退款关联。
 * - 事务内 SELECT ... FOR UPDATE 锁收款行，防并发重复退。
 */
let CodRefundPolicyService = class CodRefundPolicyService {
    constructor(connection, orderService) {
        this.connection = connection;
        this.orderService = orderService;
    }
    async findConfirmedReceipt(ctx, paymentId, lock) {
        const qb = this.connection
            .getRepository(ctx, cod_receipt_entities_1.CampusCodReceipt)
            .createQueryBuilder('r')
            .where('r.paymentId = :paymentId', { paymentId })
            .andWhere('r.status = :status', { status: 'confirmed' });
        if (lock) {
            qb.setLock('pessimistic_write');
        }
        const row = await qb.getOne();
        if (!row)
            return null;
        return { id: row.id, amount: row.amount, status: row.status };
    }
    /** 已挂在收款上的非 Failed 退款金额合计（分） */
    async usedAmount(ctx, receiptId) {
        var _a, _b;
        const rows = await this.connection.rawConnection.manager.query(`SELECT COALESCE(SUM(l."amountApplied"), 0)::int AS used
             FROM campus_cod_refund_link l
             JOIN "refund" r ON r.id = l."refundId"
             WHERE l."receiptId" = $1 AND r.state <> 'Failed'`, [receiptId]);
        return Number((_b = (_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.used) !== null && _b !== void 0 ? _b : 0);
    }
    async hasConfirmedReceipt(ctx, paymentId) {
        return (await this.findConfirmedReceipt(ctx, paymentId, false)) != null;
    }
    /** handler 内校验（无收款/超额即抛错，核心不落退款行） */
    async authorize(ctx, input) {
        const receipt = await this.findConfirmedReceipt(ctx, input.payment.id, false);
        if (!receipt) {
            throw new core_1.UserInputError('该 COD 支付没有收款记录，不能创建退款单；未收款订单请直接取消，已收款待退请走人工现金工单');
        }
        const amount = Math.round(Number(input.amount));
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new core_1.UserInputError('退款金额必须为正整数（单位：分）');
        }
        const cap = receipt.amount - (await this.usedAmount(ctx, receipt.id));
        if (amount > cap) {
            throw new core_1.UserInputError(`退款金额 ${amount} 分超过未退实收余额 ${cap} 分`);
        }
        return {
            receiptId: receipt.id,
            transactionId: `COD-CASH-${receipt.id}`,
            metadata: { codReceiptId: receipt.id, amountApplied: amount },
        };
    }
    /** 统一修改退款入口：锁收款 → 校验额度 → refundOrder → 写退款关联 */
    async createRefund(ctx, input) {
        return this.connection.withTransaction(ctx, async (txCtx) => {
            var _a, _b, _c, _d;
            const receipt = await this.findConfirmedReceipt(txCtx, input.paymentId, true);
            if (!receipt) {
                throw new core_1.UserInputError('该 COD 支付没有收款记录，不能创建退款单；未收款订单请直接取消，已收款待退请走人工现金工单');
            }
            const amount = Math.round(Number(input.amount));
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new core_1.UserInputError('退款金额必须为正整数（单位：分）');
            }
            const cap = receipt.amount - (await this.usedAmount(txCtx, receipt.id));
            if (amount > cap) {
                throw new core_1.UserInputError(`退款金额 ${amount} 分超过未退实收余额 ${cap} 分`);
            }
            const result = await this.orderService.refundOrder(txCtx, {
                orderId: input.orderId,
                lines: (_a = input.lines) !== null && _a !== void 0 ? _a : [],
                shipping: (_b = input.shipping) !== null && _b !== void 0 ? _b : 0,
                adjustment: (_c = input.adjustment) !== null && _c !== void 0 ? _c : 0,
                paymentId: input.paymentId,
                reason: input.reason,
                amount,
            });
            if (result instanceof Error || (result === null || result === void 0 ? void 0 : result.errorCode)) {
                return result;
            }
            const refund = result;
            const linkRepo = this.connection.getRepository(txCtx, cod_receipt_entities_1.CampusCodRefundLink);
            await linkRepo.save(linkRepo.create({
                refundId: refund.id,
                receiptId: receipt.id,
                orderId: Number(input.orderId),
                paymentId: Number(input.paymentId),
                amountApplied: amount,
                currencyCode: 'CNY',
                createdById: (_d = ctx.activeUserId) !== null && _d !== void 0 ? _d : null,
                note: input.reason,
            }));
            return refund;
        });
    }
    /** 台账里该支付的可退余额（供后台/对账查询） */
    async refundableAmount(ctx, paymentId) {
        const receipt = await this.findConfirmedReceipt(ctx, paymentId, false);
        if (!receipt)
            return 0;
        return receipt.amount - (await this.usedAmount(ctx, receipt.id));
    }
};
exports.CodRefundPolicyService = CodRefundPolicyService;
exports.CodRefundPolicyService = CodRefundPolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.OrderService])
], CodRefundPolicyService);
//# sourceMappingURL=cod-refund-policy.service.js.map