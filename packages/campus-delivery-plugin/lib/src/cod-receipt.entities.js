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
exports.CampusCodRefundLink = exports.CampusCodReceipt = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 货到付款（COD）现金收款记录。
 * 原则：先有收款记录，才能记载退款记录。退款必须挂在一笔真实可追溯的收款上。
 * 同一笔 payment 只允许存在一条 confirmed 收款（见迁移里的部分唯一索引）。
 */
let CampusCodReceipt = class CampusCodReceipt extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.CampusCodReceipt = CampusCodReceipt;
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "orderCode", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCodReceipt.prototype, "paymentId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCodReceipt.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'CNY' }),
    __metadata("design:type", String)
], CampusCodReceipt.prototype, "currencyCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'cash' }),
    __metadata("design:type", String)
], CampusCodReceipt.prototype, "method", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CampusCodReceipt.prototype, "collectedAt", void 0);
__decorate([
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], CampusCodReceipt.prototype, "collectedByRole", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "collectedById", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "collectedByName", void 0);
__decorate([
    (0, typeorm_1.Column)('varchar'),
    __metadata("design:type", String)
], CampusCodReceipt.prototype, "source", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "deliveryOrderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "handoverCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "deliveryRecordId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "voucherNo", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-array', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "images", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "note", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'confirmed' }),
    __metadata("design:type", String)
], CampusCodReceipt.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "voidedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "voidedById", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "voidedByName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "voidReason", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodReceipt.prototype, "idempotencyKey", void 0);
exports.CampusCodReceipt = CampusCodReceipt = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)('idx_campus_cod_receipt_channel', ['channelId', 'status']),
    (0, typeorm_1.Index)('idx_campus_cod_receipt_order', ['orderId']),
    (0, typeorm_1.Index)('idx_campus_cod_receipt_payment', ['paymentId']),
    __metadata("design:paramtypes", [Object])
], CampusCodReceipt);
/**
 * 退款单 ↔ 收款记录 的强制关联。
 * 每笔退款单只能挂一条关联（refundId 唯一），amountApplied 记录本次冲减的实收金额（分）。
 */
let CampusCodRefundLink = class CampusCodRefundLink extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.CampusCodRefundLink = CampusCodRefundLink;
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCodRefundLink.prototype, "refundId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCodRefundLink.prototype, "receiptId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodRefundLink.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCodRefundLink.prototype, "paymentId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusCodRefundLink.prototype, "amountApplied", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'CNY' }),
    __metadata("design:type", String)
], CampusCodRefundLink.prototype, "currencyCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Object)
], CampusCodRefundLink.prototype, "createdById", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusCodRefundLink.prototype, "createdByName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], CampusCodRefundLink.prototype, "note", void 0);
exports.CampusCodRefundLink = CampusCodRefundLink = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)('idx_campus_cod_refund_link_receipt', ['receiptId']),
    (0, typeorm_1.Index)('idx_campus_cod_refund_link_order', ['orderId']),
    __metadata("design:paramtypes", [Object])
], CampusCodRefundLink);
//# sourceMappingURL=cod-receipt.entities.js.map