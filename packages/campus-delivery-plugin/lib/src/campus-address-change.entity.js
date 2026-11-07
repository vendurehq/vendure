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
exports.CampusAddressChange = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 改址台账：顾客下单后修改配送地址产生的运费差额（多退少补）。
 * 差额不阻塞改址，运营在后台统一退款/补收后标记结清。
 */
let CampusAddressChange = class CampusAddressChange extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.CampusAddressChange = CampusAddressChange;
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "orderId", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], CampusAddressChange.prototype, "orderCode", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "customerId", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], CampusAddressChange.prototype, "fromZone", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], CampusAddressChange.prototype, "fromBuilding", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "fromDetail", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], CampusAddressChange.prototype, "toZone", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], CampusAddressChange.prototype, "toBuilding", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "toDetail", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusAddressChange.prototype, "oldFee", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusAddressChange.prototype, "newFee", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], CampusAddressChange.prototype, "diff", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 'pending' }),
    __metadata("design:type", String)
], CampusAddressChange.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'timestamptz' }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "settledAt", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "settledBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "settleAction", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "settleNote", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "refundId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "source", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "reason", void 0);
__decorate([
    (0, typeorm_1.Column)('int', { nullable: true }),
    __metadata("design:type", Object)
], CampusAddressChange.prototype, "changedBy", void 0);
exports.CampusAddressChange = CampusAddressChange = __decorate([
    (0, typeorm_1.Entity)()
    // 与迁移显式索引同名声明：否则 schema 校验会把这些索引判为多余并打印 DROP INDEX 噪音
    ,
    (0, typeorm_1.Index)('idx_campus_address_change_channel', ['channelId', 'status']),
    (0, typeorm_1.Index)('idx_campus_address_change_order', ['orderId']),
    __metadata("design:paramtypes", [Object])
], CampusAddressChange);
//# sourceMappingURL=campus-address-change.entity.js.map