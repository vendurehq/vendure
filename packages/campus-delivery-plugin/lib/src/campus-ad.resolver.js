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
exports.CampusAdShopResolver = exports.CampusAdAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const permissions_1 = require("./permissions");
const campus_ad_service_1 = require("./campus-ad.service");
/**
 * P2-3 广告位与商家自助投放计费（admin-api）。
 * - 商家（CampusMerchant）：看广告位报价、下单、模拟支付、取消
 * - 平台（CampusConfig）：按渠道查投放单、审核通过/驳回
 *
 * 注意：admin/shop 两套 schema 字段不同，resolver 必须拆开注册，
 * 否则任一侧缺失字段都会在启动时报 "defined in resolvers, but not in schema"。
 */
let CampusAdAdminResolver = class CampusAdAdminResolver {
    constructor(ads) {
        this.ads = ads;
    }
    async campusAdSlots() {
        return this.ads.slotList();
    }
    async campusMerchantAds(ctx) {
        return this.ads.merchantList(ctx);
    }
    async campusMerchantCreateAd(ctx, slot, title, startDate, endDate, imageUrl, linkUrl) {
        return this.ads.create(ctx, { slot, title, startDate, endDate, imageUrl, linkUrl });
    }
    async campusMerchantPayAd(ctx, id) {
        return this.ads.pay(ctx, id);
    }
    async campusMerchantCancelAd(ctx, id) {
        return this.ads.cancel(ctx, id);
    }
    async campusAdCampaigns(ctx, status, channelId, skip, take) {
        return this.ads.adminList(ctx, status, channelId, skip !== null && skip !== void 0 ? skip : 0, take !== null && take !== void 0 ? take : 20);
    }
    async campusReviewAd(ctx, id, approve, note) {
        return this.ads.review(ctx, id, approve, note);
    }
};
exports.CampusAdAdminResolver = CampusAdAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant, permissions_1.CampusPermissions.CampusConfig),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusAdSlots", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusMerchantAds", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('slot')),
    __param(2, (0, graphql_1.Args)('title')),
    __param(3, (0, graphql_1.Args)('startDate')),
    __param(4, (0, graphql_1.Args)('endDate')),
    __param(5, (0, graphql_1.Args)({ name: 'imageUrl', nullable: true })),
    __param(6, (0, graphql_1.Args)({ name: 'linkUrl', nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusMerchantCreateAd", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusMerchantPayAd", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusMerchant),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusMerchantCancelAd", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'status', nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'channelId', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'skip', type: () => graphql_1.Int, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'take', type: () => graphql_1.Int, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusAdCampaigns", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusConfig),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('approve')),
    __param(3, (0, graphql_1.Args)({ name: 'note', nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Boolean, Object]),
    __metadata("design:returntype", Promise)
], CampusAdAdminResolver.prototype, "campusReviewAd", null);
exports.CampusAdAdminResolver = CampusAdAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [campus_ad_service_1.CampusAdService])
], CampusAdAdminResolver);
/** P2-3 广告位（shop-api）：C 端公开只读取当前在投广告 */
let CampusAdShopResolver = class CampusAdShopResolver {
    constructor(ads) {
        this.ads = ads;
    }
    async campusActiveAds(ctx, slot) {
        return this.ads.activeAds(ctx, slot);
    }
};
exports.CampusAdShopResolver = CampusAdShopResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('slot')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], CampusAdShopResolver.prototype, "campusActiveAds", null);
exports.CampusAdShopResolver = CampusAdShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [campus_ad_service_1.CampusAdService])
], CampusAdShopResolver);
//# sourceMappingURL=campus-ad.resolver.js.map