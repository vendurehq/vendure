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
exports.ShopResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const core_2 = require("@vendure/core");
const marketplace_seller_service_1 = require("../marketplace-seller-service");
const marketplace_service_1 = require("../marketplace.service");
let ShopResolver = class ShopResolver {
    constructor(marketplaceSellerService, marketplaceService, connection) {
        this.marketplaceSellerService = marketplaceSellerService;
        this.marketplaceService = marketplaceService;
        this.connection = connection;
    }
    /** Product.name/slug 为非实体列，需从 translations 取（优先当前语言，回退首个） */
    translate(product) {
        var _a, _b, _c;
        const translations = ((_a = product.translations) !== null && _a !== void 0 ? _a : []);
        return (_c = (_b = translations.find(t => t.languageCode === core_1.LanguageCode.zh_Hans)) !== null && _b !== void 0 ? _b : translations[0]) !== null && _c !== void 0 ? _c : {};
    }
    async registerMarketplaceSeller(ctx, args) {
        try {
            const channel = await this.marketplaceSellerService.registerMarketplaceSeller(ctx, args.input);
            return {
                __typename: 'RegisterMarketplaceSellerSuccess',
                id: channel.id,
                code: channel.code,
                token: channel.token,
            };
        }
        catch (e) {
            if (e instanceof core_1.InternalServerError) {
                return { __typename: 'RegisterMarketplaceSellerError', errorCode: 'INTERNAL_SERVER_ERROR', message: e.message };
            }
            throw e;
        }
    }
    /** 聚合列表项映射：product → GraphQL MarketplaceProduct */
    toMarketplaceProduct(product) {
        var _a, _b, _c, _d, _e, _f;
        return {
            id: product.id,
            name: (_a = this.translate(product).name) !== null && _a !== void 0 ? _a : '',
            slug: (_b = this.translate(product).slug) !== null && _b !== void 0 ? _b : '',
            barcode: (_c = product.customFields.barcode) !== null && _c !== void 0 ? _c : null,
            internalCode: (_d = product.customFields.internalCode) !== null && _d !== void 0 ? _d : null,
            merchantChannel: product.customFields.merchantRef
                ? {
                    id: product.customFields.merchantRef.id,
                    code: product.customFields.merchantRef.code,
                    name: (_f = (_e = product.customFields.merchantRef.seller) === null || _e === void 0 ? void 0 : _e.name) !== null && _f !== void 0 ? _f : product.customFields.merchantRef.code,
                }
                : null,
        };
    }
    /** take 限定 1..100，skip 不得为负；未传时保持原行为（不限制） */
    normalizePaging(take, skip) {
        return {
            take: take == null ? undefined : Math.min(Math.max(Math.trunc(take), 1), 100),
            skip: skip == null ? undefined : Math.max(Math.trunc(skip), 0),
        };
    }
    async marketplaceProducts(ctx, args) {
        const paging = this.normalizePaging(args.take, args.skip);
        const products = await this.marketplaceService.getMarketplaceProducts(ctx, paging);
        return products.map(product => this.toMarketplaceProduct(product));
    }
    /** 分页版本：返回切片 + totalItems（不改变 marketplaceProducts 的返回类型） */
    async marketplaceProductPage(ctx, args) {
        var _a, _b;
        const take = Math.min(Math.max(Math.trunc((_a = args.take) !== null && _a !== void 0 ? _a : 12), 1), 100);
        const skip = Math.max(Math.trunc((_b = args.skip) !== null && _b !== void 0 ? _b : 0), 0);
        const [products, totalItems] = await Promise.all([
            this.marketplaceService.getMarketplaceProducts(ctx, { take, skip }),
            this.marketplaceService.countMarketplaceProducts(ctx),
        ]);
        return {
            items: products.map(product => this.toMarketplaceProduct(product)),
            totalItems,
        };
    }
    async submitForMarketplace(ctx, args) {
        await this.marketplaceService.submitForMarketplace(ctx, args.productId);
        return true;
    }
    async myMerchantProducts(ctx) {
        const products = await this.connection.getRepository(ctx, core_2.Product).find({
            where: { channels: { id: ctx.channelId } },
        });
        return products.map(product => {
            var _a, _b, _c, _d, _e, _f, _g;
            return ({
                id: product.id,
                name: (_a = this.translate(product).name) !== null && _a !== void 0 ? _a : '',
                slug: (_b = this.translate(product).slug) !== null && _b !== void 0 ? _b : '',
                barcode: (_c = product.customFields.barcode) !== null && _c !== void 0 ? _c : null,
                internalCode: (_d = product.customFields.internalCode) !== null && _d !== void 0 ? _d : null,
                marketplaceStatus: (_e = product.customFields.marketplaceStatus) !== null && _e !== void 0 ? _e : 'pending',
                rejectReason: (_f = product.customFields.rejectReason) !== null && _f !== void 0 ? _f : null,
                listedInMarketplace: (_g = product.customFields.listedInMarketplace) !== null && _g !== void 0 ? _g : false,
            });
        });
    }
    async marketplacePendingProducts(ctx) {
        const products = await this.marketplaceService.getPendingProducts(ctx);
        return products.map(product => {
            var _a, _b, _c, _d, _e, _f, _g;
            return ({
                id: product.id,
                name: (_a = this.translate(product).name) !== null && _a !== void 0 ? _a : '',
                slug: (_b = this.translate(product).slug) !== null && _b !== void 0 ? _b : '',
                barcode: (_c = product.customFields.barcode) !== null && _c !== void 0 ? _c : null,
                internalCode: (_d = product.customFields.internalCode) !== null && _d !== void 0 ? _d : null,
                marketplaceStatus: (_e = product.customFields.marketplaceStatus) !== null && _e !== void 0 ? _e : 'pending',
                rejectReason: (_f = product.customFields.rejectReason) !== null && _f !== void 0 ? _f : null,
                listedInMarketplace: (_g = product.customFields.listedInMarketplace) !== null && _g !== void 0 ? _g : false,
            });
        });
    }
    async marketplaceApprove(ctx, args) {
        await this.marketplaceService.approveMarketplaceProduct(ctx, args.productId);
        return true;
    }
    async marketplaceReject(ctx, args) {
        await this.marketplaceService.rejectMarketplaceProduct(ctx, args.productId, args.reason);
        return true;
    }
};
exports.ShopResolver = ShopResolver;
__decorate([
    (0, graphql_1.Mutation)('registerMarketplaceSeller'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "registerMarketplaceSeller", null);
__decorate([
    (0, graphql_1.Query)('marketplaceProducts'),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "marketplaceProducts", null);
__decorate([
    (0, graphql_1.Query)('marketplaceProductPage'),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "marketplaceProductPage", null);
__decorate([
    (0, graphql_1.Mutation)('submitForMarketplace'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.UpdateCatalog, core_1.Permission.UpdateProduct),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "submitForMarketplace", null);
__decorate([
    (0, graphql_1.Query)('myMerchantProducts'),
    (0, core_1.Allow)(core_1.Permission.ReadCatalog, core_1.Permission.ReadProduct),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "myMerchantProducts", null);
__decorate([
    (0, graphql_1.Query)('marketplacePendingProducts'),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin, core_1.Permission.UpdateProduct),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "marketplacePendingProducts", null);
__decorate([
    (0, graphql_1.Mutation)('marketplaceApprove'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin, core_1.Permission.UpdateProduct),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "marketplaceApprove", null);
__decorate([
    (0, graphql_1.Mutation)('marketplaceReject'),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin, core_1.Permission.UpdateProduct),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopResolver.prototype, "marketplaceReject", null);
exports.ShopResolver = ShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [marketplace_seller_service_1.MarketplaceSellerService,
        marketplace_service_1.MarketplaceService,
        core_1.TransactionalConnection])
], ShopResolver);
