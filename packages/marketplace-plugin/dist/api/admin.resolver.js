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
exports.AdminMarketplaceResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const marketplace_service_1 = require("../marketplace.service");
const merchant_api_token_service_1 = require("../merchant-api-token.service");
let AdminMarketplaceResolver = class AdminMarketplaceResolver {
    constructor(marketplaceService, connection, merchantApiTokenService) {
        this.marketplaceService = marketplaceService;
        this.connection = connection;
        this.merchantApiTokenService = merchantApiTokenService;
    }
    /** 为指定商家渠道签发 merchant-api 令牌（仅平台超管） */
    issueMerchantApiToken(args) {
        const ttl = args.ttlSeconds && args.ttlSeconds > 0 ? args.ttlSeconds : 24 * 60 * 60;
        return {
            token: this.merchantApiTokenService.issue(args.channelId, ttl),
            expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        };
    }
    async approveMarketplaceProduct(ctx, args) {
        await this.marketplaceService.approveMarketplaceProduct(ctx, args.productId);
        return true;
    }
    async rejectMarketplaceProduct(ctx, args) {
        await this.marketplaceService.rejectMarketplaceProduct(ctx, args.productId, args.reason);
        return true;
    }
    async submitForMarketplaceAdmin(ctx, args) {
        await this.marketplaceService.submitForMarketplaceOwnedByChannel(ctx, args.productId, ctx.channelId);
        return true;
    }
    async marketplacePendingProducts(ctx) {
        const products = await this.marketplaceService.getPendingProducts(ctx);
        return products;
    }
    async approvedMarketplaceProducts(ctx) {
        const products = await this.marketplaceService.getApprovedProducts(ctx);
        return products;
    }
    async platformCollections(ctx) {
        return this.marketplaceService.getPlatformCollections(ctx);
    }
    async setProductPlatformCategory(ctx, args) {
        var _a;
        await this.marketplaceService.setProductPlatformCategory(ctx, args.productId, (_a = args.collectionId) !== null && _a !== void 0 ? _a : '');
        return true;
    }
    marketplaceMerchantChannel(ctx) {
        return ctx.channel;
    }
    async merchantOrders(ctx, args) {
        var _a, _b, _c, _d;
        const qb = this.connection
            .getRepository(ctx, core_1.Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .where('channel.id = :channelId', { channelId: ctx.channelId });
        const orders = await qb.getMany();
        const filtered = args.saleSource
            ? orders.filter(o => { var _a; return ((_a = o.customFields) === null || _a === void 0 ? void 0 : _a.saleSource) === args.saleSource; })
            : orders;
        const skip = (_b = (_a = args.options) === null || _a === void 0 ? void 0 : _a.skip) !== null && _b !== void 0 ? _b : 0;
        const take = (_d = (_c = args.options) === null || _c === void 0 ? void 0 : _c.take) !== null && _d !== void 0 ? _d : filtered.length;
        return {
            items: filtered.slice(skip, skip + take),
            totalItems: filtered.length,
        };
    }
};
exports.AdminMarketplaceResolver = AdminMarketplaceResolver;
__decorate([
    (0, graphql_1.Mutation)('issueMerchantApiToken'),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], AdminMarketplaceResolver.prototype, "issueMerchantApiToken", null);
__decorate([
    (0, graphql_1.Mutation)('approveMarketplaceProduct'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.UpdateProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "approveMarketplaceProduct", null);
__decorate([
    (0, graphql_1.Mutation)('rejectMarketplaceProduct'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.UpdateProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "rejectMarketplaceProduct", null);
__decorate([
    (0, graphql_1.Mutation)('submitForMarketplaceAdmin'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.UpdateCatalog, core_1.Permission.UpdateProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "submitForMarketplaceAdmin", null);
__decorate([
    (0, graphql_1.Query)('marketplacePendingProducts'),
    (0, core_1.Allow)(core_1.Permission.ReadProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "marketplacePendingProducts", null);
__decorate([
    (0, graphql_1.Query)('approvedMarketplaceProducts'),
    (0, core_1.Allow)(core_1.Permission.ReadProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "approvedMarketplaceProducts", null);
__decorate([
    (0, graphql_1.Query)('platformCollections'),
    (0, core_1.Allow)(core_1.Permission.ReadProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "platformCollections", null);
__decorate([
    (0, graphql_1.Mutation)('setProductPlatformCategory'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.UpdateProduct, core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "setProductPlatformCategory", null);
__decorate([
    (0, graphql_1.Query)('marketplaceMerchantChannel'),
    (0, core_1.Allow)(core_1.Permission.ReadOrder),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", void 0)
], AdminMarketplaceResolver.prototype, "marketplaceMerchantChannel", null);
__decorate([
    (0, graphql_1.Query)('merchantOrders'),
    (0, core_1.Allow)(core_1.Permission.ReadOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMarketplaceResolver.prototype, "merchantOrders", null);
exports.AdminMarketplaceResolver = AdminMarketplaceResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [marketplace_service_1.MarketplaceService,
        core_1.TransactionalConnection,
        merchant_api_token_service_1.MerchantApiTokenService])
], AdminMarketplaceResolver);
