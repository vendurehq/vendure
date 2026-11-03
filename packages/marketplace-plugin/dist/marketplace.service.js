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
exports.MarketplaceService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
let MarketplaceService = class MarketplaceService {
    constructor(connection, entityHydrator, channelService, productService) {
        this.connection = connection;
        this.entityHydrator = entityHydrator;
        this.channelService = channelService;
        this.productService = productService;
    }
    /** 校验条形码在平台内唯一（跨所有 Channel）。返回所属 ProductId 与首个 VariantId；空则无冲突。 */
    async findBarcodeOwner(barcode) {
        if (!barcode)
            return null;
        const repo = this.connection.rawConnection.getRepository(core_1.Product);
        const product = await repo.findOne({
            where: { customFields: { barcode } },
            relations: ['variants'],
        });
        if (!product || !product.variants || product.variants.length === 0) {
            return null;
        }
        return { productId: product.id, variantId: product.variants[0].id };
    }
    /** 保存前校验：若 barcode 已被其他商品占用则抛错 */
    async assertBarcodeUnique(barcode, excludeProductId) {
        const owner = await this.findBarcodeOwner(barcode);
        if (owner && (!excludeProductId || owner.productId !== excludeProductId)) {
            throw new core_1.UserInputError(`条形码 ${barcode} 已被占用`);
        }
    }
    async getProductOrThrow(ctx, productId) {
        const product = await this.connection.getRepository(ctx, core_1.Product).findOne({
            where: { id: productId },
        });
        if (!product) {
            throw new core_1.UserInputError('商品不存在');
        }
        return product;
    }
    /** 校验商品归属指定渠道后可提交上架（供 admin API，防止商户提审他人商品） */
    async submitForMarketplaceOwnedByChannel(ctx, productId, channelId) {
        const product = await this.getProductOrThrow(ctx, productId);
        await this.entityHydrator.hydrate(ctx, product, { relations: ['channels'] });
        const owned = (product.channels || []).some(c => (0, core_1.idsAreEqual)(c.id, channelId));
        if (!owned && channelId != null) {
            throw new core_1.UserInputError('只能对当前店铺的商品提交上架');
        }
        await this.submitForMarketplace(ctx, productId);
    }
    /** 商家提交商品上架 marketplace（置审批中，不对外展示） */
    async submitForMarketplace(ctx, productId) {
        const product = await this.getProductOrThrow(ctx, productId);
        if (product.customFields.barcode) {
            await this.assertBarcodeUnique(product.customFields.barcode, productId);
        }
        product.customFields.listedInMarketplace = false;
        product.customFields.marketplaceStatus = constants_1.MARKETPLACE_STATUS_PENDING;
        product.customFields.rejectReason = undefined;
        await this.connection.getRepository(ctx, core_1.Product).save(product);
    }
    /** 平台运营/超管审批通过：对外展示 */
    async approveMarketplaceProduct(ctx, productId) {
        var _a, _b;
        const product = await this.getProductOrThrow(ctx, productId);
        // 商家商品归属于 default + 商家渠道：merchantRef 指向非默认渠道（与分单策略一致）。
        // 仅属于 default 的自营商品则 merchantRef 保持 null。
        await this.entityHydrator.hydrate(ctx, product, { relations: ['channels'] });
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const nonDefaultChannel = (_a = product.channels) === null || _a === void 0 ? void 0 : _a.find(c => !(0, core_1.idsAreEqual)(c.id, defaultChannel.id));
        product.customFields.merchantRef = nonDefaultChannel ? nonDefaultChannel.id : null;
        product.customFields.marketplaceStatus = constants_1.MARKETPLACE_STATUS_APPROVED;
        product.customFields.listedInMarketplace = true;
        product.customFields.rejectReason = undefined;
        // —— 内置轻量归位：按租户分类名 → 平台分类映射，补挂默认渠道并标记待归类 ——
        try {
            await this.placeIntoTenantCategory(ctx, product);
        }
        catch (e) {
            core_1.Logger.warn(`产品 ${String(productId)} 归位失败: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, 'Marketplace');
            product.customFields.needsCategorization = true;
        }
        await this.connection.getRepository(ctx, core_1.Product).save(product);
    }
    /**
     * 内置轻量归位：根据商品在租户侧的分类名（tenantCategoryRef）+ 该租户渠道上的 categoryMapping，
     * 映射到默认商城平台分类；未命中则标记待归类。同时把商品补挂默认渠道
     * （assignProductsToChannel 一并迁移变体/资产/规格组）。
     */
    async placeIntoTenantCategory(ctx, product) {
        var _a, _b, _c, _d;
        await this.entityHydrator.hydrate(ctx, product, { relations: ['channels'] });
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const tenantChannel = ((_a = product.channels) !== null && _a !== void 0 ? _a : []).find((c) => !(0, core_1.idsAreEqual)(c.id, defaultChannel.id));
        const tenantCategoryRef = (_b = product.customFields) === null || _b === void 0 ? void 0 : _b.tenantCategoryRef;
        let mapping = [];
        if (tenantChannel) {
            const channelRepo = this.connection.rawConnection.getRepository(core_1.Channel);
            const tenant = await channelRepo.findOne({ where: { id: String(tenantChannel.id) } });
            const rawMap = (_c = tenant === null || tenant === void 0 ? void 0 : tenant.customFields) === null || _c === void 0 ? void 0 : _c.categoryMapping;
            if (Array.isArray(rawMap))
                mapping = rawMap;
        }
        const hit = tenantCategoryRef ? mapping.find(m => m.tenantCategory === tenantCategoryRef) : undefined;
        const alreadyOnDefault = ((_d = product.channels) !== null && _d !== void 0 ? _d : []).some((c) => (0, core_1.idsAreEqual)(c.id, defaultChannel.id));
        if (!alreadyOnDefault) {
            await this.productService.assignProductsToChannel(ctx, {
                channelId: defaultChannel.id,
                productIds: [String(product.id)],
                priceFactor: 1,
            });
        }
        if (hit === null || hit === void 0 ? void 0 : hit.collectionId) {
            product.customFields.needsCategorization = false;
            product.customFields.platformCategoryId = hit.collectionId;
        }
        else {
            product.customFields.needsCategorization = true;
            product.customFields.platformCategoryId = null;
        }
    }
    /** 平台运营/超管驳回：不展示，记录原因 */
    async rejectMarketplaceProduct(ctx, productId, reason) {
        const product = await this.getProductOrThrow(ctx, productId);
        product.customFields.marketplaceStatus = constants_1.MARKETPLACE_STATUS_REJECTED;
        product.customFields.listedInMarketplace = false;
        product.customFields.rejectReason = reason;
        await this.connection.getRepository(ctx, core_1.Product).save(product);
    }
    /** 待审批商品列表 */
    async getPendingProducts(ctx) {
        return this.connection.getRepository(ctx, core_1.Product).find({
            where: { customFields: { marketplaceStatus: constants_1.MARKETPLACE_STATUS_PENDING } },
        });
    }
    /** 已过审（approved）商品列表：供运营查看分类归属 / 手动归类 */
    async getApprovedProducts(ctx) {
        return this.connection.getRepository(ctx, core_1.Product).find({
            where: { customFields: { marketplaceStatus: constants_1.MARKETPLACE_STATUS_APPROVED } },
        });
    }
    /**
     * 平台（默认租户）分类列表：审批手动归类 / 租户归位映射下拉用。
     * 始终基于 default channel，而不是登录运营/商户所在租户渠道的分类。
     */
    async getPlatformCollections(ctx) {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const repo = this.connection.rawConnection.getRepository(core_1.Collection);
        const all = await repo.find({ relations: ['translations', 'channels', 'parent'] });
        return all
            .filter((c) => (c.channels || []).some((ch) => (0, core_1.idsAreEqual)(ch.id, defaultChannel.id)))
            .map((c) => {
            var _a, _b, _c, _d, _e;
            return ({
                id: String(c.id),
                name: ((_c = (_b = (_a = c.translations) === null || _a === void 0 ? void 0 : _a.find) === null || _b === void 0 ? void 0 : _b.call(_a, (t) => t.languageCode === 'zh_Hans')) === null || _c === void 0 ? void 0 : _c.name) ||
                    ((_e = (_d = c.translations) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.name) ||
                    String(c.id),
                parentId: c.parent ? String(c.parent.id) : null,
            });
        });
    }
    /** 运营手动归类已过审商品：collectionId 为空 → 置待归类；否则写入平台分类并清标记 */
    async setProductPlatformCategory(ctx, productId, collectionId) {
        const product = await this.getProductOrThrow(ctx, productId);
        product.customFields.platformCategoryId = collectionId || null;
        product.customFields.needsCategorization = !collectionId;
        await this.connection.getRepository(ctx, core_1.Product).save(product);
    }
    /** marketplace 聚合商品过滤条件：已审批且已上架 */
    marketplaceProductsWhere() {
        return {
            customFields: {
                marketplaceStatus: constants_1.MARKETPLACE_STATUS_APPROVED,
                listedInMarketplace: true,
            },
        };
    }
    /** 聚合 marketplace 商品总数（与 getMarketplaceProducts 使用同一过滤条件） */
    async countMarketplaceProducts(ctx) {
        return this.connection.getRepository(ctx, core_1.Product).count({
            where: this.marketplaceProductsWhere(),
        });
    }
    /**
     * 聚合 marketplace 对外展示的商品（自营 + 各商家）。
     * 仅返回 marketplaceStatus='approved' 且 listedInMarketplace=true 的商品，
     * 并 hydrate 商家渠道（merchantRef）与商品主图（featuredAsset），供前端按商家分组展示。
     * relation custom field 存储于独立 junction 表，故用 EntityHydrator 加载最稳妥。
     */
    async getMarketplaceProducts(ctx, options) {
        const products = await this.connection.getRepository(ctx, core_1.Product).find({
            where: this.marketplaceProductsWhere(),
            // 稳定排序，保证 skip/take 分页切片确定（不传分页参数时输出顺序也固定）
            order: { id: 'ASC' },
            take: options === null || options === void 0 ? void 0 : options.take,
            skip: options === null || options === void 0 ? void 0 : options.skip,
        });
        for (const product of products) {
            await this.entityHydrator.hydrate(ctx, product, {
                relations: ['customFields.merchantRef.seller', 'featuredAsset'],
            });
        }
        return products;
    }
};
exports.MarketplaceService = MarketplaceService;
exports.MarketplaceService = MarketplaceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.EntityHydrator,
        core_1.ChannelService,
        core_1.ProductService])
], MarketplaceService);
