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
exports.CampusLockerShopResolver = exports.CampusLockerAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const permissions_1 = require("./permissions");
const campus_locker_service_1 = require("./campus-locker.service");
/**
 * P2-4 智能取餐柜 / 无人配送（admin-api）。
 * - 商家（CampusMerchant）：看本站点柜机、看无人配送通道状态
 * - 平台（CampusConfig）：站点增删改、无人配送通道配置
 *
 * 注意：admin/shop 两套 schema 字段不同，resolver 必须拆两个类注册，
 * 否则任一侧缺字段都会在启动时报 "defined in resolvers, but not in schema"。
 */
let CampusLockerAdminResolver = class CampusLockerAdminResolver {
    constructor(lockers) {
        this.lockers = lockers;
    }
    async campusLockerStations(ctx) {
        return this.lockers.adminList(ctx);
    }
    async campusCreateLockerStation(ctx, input) {
        return this.lockers.create(ctx, input);
    }
    async campusUpdateLockerStation(ctx, id, input) {
        return this.lockers.update(ctx, id, input);
    }
    async campusDeleteLockerStation(ctx, id) {
        return this.lockers.remove(ctx, id);
    }
    async campusUnmannedChannel(ctx) {
        return this.lockers.channel(ctx);
    }
    async campusUpdateUnmannedChannel(ctx, input) {
        return this.lockers.updateChannel(ctx, input);
    }
    /** 调用占位：真实厂商 SDK 未接，当前只做配置校验 + 模拟受理（返回单号） */
    async campusRequestUnmannedDelivery(ctx, orderId) {
        return this.lockers.requestDelivery(ctx, orderId);
    }
};
exports.CampusLockerAdminResolver = CampusLockerAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusLockerStations", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusCreateLockerStation", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusUpdateLockerStation", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusDeleteLockerStation", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusUnmannedChannel", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusUpdateUnmannedChannel", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CampusLockerAdminResolver.prototype, "campusRequestUnmannedDelivery", null);
exports.CampusLockerAdminResolver = CampusLockerAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [campus_locker_service_1.CampusLockerService])
], CampusLockerAdminResolver);
/** P2-4 智能取餐柜（shop-api）：C 端公开只读启用站点 + 无人配送是否开通 */
let CampusLockerShopResolver = class CampusLockerShopResolver {
    constructor(lockers) {
        this.lockers = lockers;
    }
    async campusLockerStations(ctx) {
        return this.lockers.shopList(ctx);
    }
    async campusUnmannedDeliveryChannel(ctx) {
        const ch = await this.lockers.channel(ctx);
        return { enabled: ch.enabled, provider: ch.provider, providerName: ch.providerName, integrated: ch.integrated };
    }
};
exports.CampusLockerShopResolver = CampusLockerShopResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], CampusLockerShopResolver.prototype, "campusLockerStations", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], CampusLockerShopResolver.prototype, "campusUnmannedDeliveryChannel", null);
exports.CampusLockerShopResolver = CampusLockerShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [campus_locker_service_1.CampusLockerService])
], CampusLockerShopResolver);
//# sourceMappingURL=campus-locker.resolver.js.map