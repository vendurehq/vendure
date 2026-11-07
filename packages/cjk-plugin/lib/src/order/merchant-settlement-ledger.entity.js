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
exports.MerchantSettlementLedger = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 商户分账台账（Merchant Settlement Ledger）：「per-box checkout」的台账级分账记录。
 *
 * 结算拆单时，为一笔已结算订单下的**每个商户（租户）**各记录一行——该订单应付该商户的金额。
 * 通道级分账（向第三方支付通道请求实际拆账/代付/进件）明确不在本表范围内，本表仅作为分账依据。
 *
 * `status`：
 * - `PAID`：在线支付（余额钱包 / 支付宝 / 微信等）在结算时即已收款；
 * - `PENDING_SIGN`：货到付款（COD）结算时尚未实质收款，待「签收事件」触发后翻转为 `PAID`。
 *   PENDING_SIGN → PAID 的翻转接线属后续细化（chore），此处仅占位，并留状态值以便后续翻转。
 *
 * `createdAt` / `updatedAt` 由 VendureEntity 基类提供（CreateDateColumn / UpdateDateColumn）。
 * `id`（自增 int 主键）亦由 VendureEntity 基类提供。
 */
let MerchantSettlementLedger = class MerchantSettlementLedger extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.MerchantSettlementLedger = MerchantSettlementLedger;
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], MerchantSettlementLedger.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], MerchantSettlementLedger.prototype, "tenantChannelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "tenantName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', default: 0 }),
    __metadata("design:type", Number)
], MerchantSettlementLedger.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "settleMethod", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], MerchantSettlementLedger.prototype, "occurredAt", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "collectorChannelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "collectorName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "orderCode", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], MerchantSettlementLedger.prototype, "collectedAt", void 0);
exports.MerchantSettlementLedger = MerchantSettlementLedger = __decorate([
    (0, typeorm_1.Entity)('merchant_settlement_ledger'),
    __metadata("design:paramtypes", [Object])
], MerchantSettlementLedger);
//# sourceMappingURL=merchant-settlement-ledger.entity.js.map