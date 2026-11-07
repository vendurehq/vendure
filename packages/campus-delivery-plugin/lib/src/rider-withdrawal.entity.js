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
exports.RiderWithdrawalRequest = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
let RiderWithdrawalRequest = class RiderWithdrawalRequest extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.RiderWithdrawalRequest = RiderWithdrawalRequest;
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], RiderWithdrawalRequest.prototype, "customerId", void 0);
__decorate([
    (0, typeorm_1.Column)('int'),
    __metadata("design:type", Number)
], RiderWithdrawalRequest.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], RiderWithdrawalRequest.prototype, "amount", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], RiderWithdrawalRequest.prototype, "channel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], RiderWithdrawalRequest.prototype, "account", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'PENDING' }),
    __metadata("design:type", String)
], RiderWithdrawalRequest.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true, default: 'confirmed' }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "withdrawState", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "remark", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "reviewedBy", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "reviewedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "payoutRef", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "payoutProof", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], RiderWithdrawalRequest.prototype, "failReason", void 0);
exports.RiderWithdrawalRequest = RiderWithdrawalRequest = __decorate([
    (0, typeorm_1.Entity)(),
    (0, typeorm_1.Index)(['channelId', 'status']),
    __metadata("design:paramtypes", [Object])
], RiderWithdrawalRequest);
//# sourceMappingURL=rider-withdrawal.entity.js.map