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
exports.CommunityActivity = void 0;
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
let CommunityActivity = class CommunityActivity extends core_1.VendureEntity {
    constructor(input) {
        super(input);
    }
};
exports.CommunityActivity = CommunityActivity;
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)(),
    __metadata("design:type", Number)
], CommunityActivity.prototype, "channelId", void 0);
__decorate([
    (0, typeorm_1.ManyToMany)(() => core_1.Channel),
    (0, typeorm_1.JoinTable)(),
    __metadata("design:type", Array)
], CommunityActivity.prototype, "channels", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], CommunityActivity.prototype, "leaderId", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int' }),
    __metadata("design:type", Number)
], CommunityActivity.prototype, "pickupLocationId", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CommunityActivity.prototype, "windowStart", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CommunityActivity.prototype, "windowEnd", void 0);
__decorate([
    (0, typeorm_1.Index)(),
    (0, typeorm_1.Column)({ type: 'timestamptz' }),
    __metadata("design:type", Date)
], CommunityActivity.prototype, "cutoffTime", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'bigint' }) // 千分比，3% = 3000
    ,
    __metadata("design:type", Number)
], CommunityActivity.prototype, "commissionRate", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', default: 'draft' }),
    __metadata("design:type", String)
], CommunityActivity.prototype, "status", void 0);
exports.CommunityActivity = CommunityActivity = __decorate([
    (0, typeorm_1.Entity)(),
    __metadata("design:paramtypes", [Object])
], CommunityActivity);
//# sourceMappingURL=community-activity.entity.js.map