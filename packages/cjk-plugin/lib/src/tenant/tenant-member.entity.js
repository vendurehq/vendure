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
exports.TenantMember = void 0;
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
/**
 * 租户内部人员关联表：承载「后台人员 × 所属租户」的归属、启停与备注。
 * 后台人员本体仍是 Vendure 原生 Administrator，本表不改原生实体。
 */
let TenantMember = class TenantMember extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.TenantMember = TenantMember;
__decorate([
    (0, typeorm_1.ManyToOne)(() => core_1.Administrator, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'administrator_id' }),
    __metadata("design:type", core_1.Administrator)
], TenantMember.prototype, "administrator", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantMember.prototype, "administratorId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => core_1.Channel, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'channel_id' }),
    __metadata("design:type", core_1.Channel)
], TenantMember.prototype, "channel", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantMember.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: true }),
    __metadata("design:type", Boolean)
], TenantMember.prototype, "enabled", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], TenantMember.prototype, "mustChangePassword", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamptz', nullable: true }),
    __metadata("design:type", Object)
], TenantMember.prototype, "resetPasswordExpiresAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], TenantMember.prototype, "displayName", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], TenantMember.prototype, "remark", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', length: 32, nullable: true }),
    __metadata("design:type", Object)
], TenantMember.prototype, "phone", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-json', default: [] }),
    __metadata("design:type", Array)
], TenantMember.prototype, "shippingProfileIds", void 0);
exports.TenantMember = TenantMember = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], TenantMember);
//# sourceMappingURL=tenant-member.entity.js.map