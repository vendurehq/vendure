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
exports.TenantCatalogService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
let TenantCatalogService = class TenantCatalogService {
    constructor(collectionService, channelService, connection) {
        this.collectionService = collectionService;
        this.channelService = channelService;
        this.connection = connection;
    }
    /** 是否平台超管（沿用 my-access 的口径：session.user.superAdmin 或任一渠道角色含 SuperAdmin） */
    isSuperAdmin(ctx) {
        var _a;
        const user = (_a = ctx.session) === null || _a === void 0 ? void 0 : _a.user;
        if ((user === null || user === void 0 ? void 0 : user.superAdmin) === true)
            return true;
        const perms = (user === null || user === void 0 ? void 0 : user.channelPermissions) || [];
        return perms.some((cp) => (cp.permissions || []).includes(core_1.Permission.SuperAdmin));
    }
    /** 目标渠道必须属于操作者的 channelPermissions（或超管），防止跨租户操作他人渠道 */
    assertChannelAccess(ctx, channelId) {
        var _a, _b;
        if (this.isSuperAdmin(ctx))
            return;
        const perms = (((_b = (_a = ctx.session) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.channelPermissions) || []);
        const allowed = perms.some((c) => String(c.id) === String(channelId));
        if (!allowed) {
            // 目标渠道不在操作者 channelPermissions 内
            throw new core_1.ForbiddenError();
        }
    }
    /** 商品必须属于当前请求渠道，防止 A 店改 B 店商品 */
    async assertProductInChannel(ctx, productId) {
        const product = await this.connection
            .getRepository(ctx, core_1.Product)
            .findOne({ where: { id: String(productId) }, relations: ['channels'] });
        if (!product) {
            throw new core_1.UserInputError(`商品 ${productId} 不存在`);
        }
        const belongs = (product.channels || []).some((c) => String(c.id) === String(ctx.channelId));
        if (!belongs) {
            // 商品不属于当前渠道
            throw new core_1.ForbiddenError();
        }
        return product;
    }
    /**
     * 分类归属校验：超管放行；否则分类须挂当前渠道（租户自有分类）
     * 或挂默认渠道（平台公共分类，租户归位时允许追加商品）。
     */
    async assertCollectionAccess(ctx, collection) {
        if (this.isSuperAdmin(ctx))
            return;
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const channelIds = new Set([
            String(ctx.channelId),
            String(defaultChannel.id),
        ]);
        const belongs = (collection.channels || []).some((c) => channelIds.has(String(c.id)));
        if (!belongs) {
            // 分类既不属于当前渠道，也不是默认渠道的平台分类
            throw new core_1.ForbiddenError();
        }
    }
    /** 解析 productIds 参数值：Vendure ConfigArg 中 list 型参数以 JSON 字符串存储（如 '[60]' / '["60"]'），兼容数组。 */
    parseIdList(value) {
        if (Array.isArray(value))
            return value.map(String);
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.map(String) : [];
            }
            catch (_a) {
                return value ? [value] : [];
            }
        }
        return [];
    }
    /**
     * 创建租户分类后，主动从默认渠道摘除，实现「租户分类只挂租户渠道、进默认商城」双轨隔离。
     * 不能走 removeCollectionsFromChannel（会对默认渠道抛错），须直接 channelService.removeFromChannels。
     */
    async createTenantCollection(ctx, input) {
        const collection = await this.collectionService.create(ctx, input);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!(0, core_1.idsAreEqual)(defaultChannel.id, ctx.channelId)) {
            await this.channelService.removeFromChannels(ctx, core_1.Collection, collection.id, [
                defaultChannel.id,
            ]);
        }
        return (0, core_1.assertFound)(this.collectionService.findOne(ctx, collection.id));
    }
    /** 把商品 ID 追加进平台分类的 productId 过滤器（只增；非 productId 独过滤器则新建一条 productId 过滤器，不改其它过滤器）。 */
    async addProductToCollection(ctx, productId, collectionId) {
        var _a, _b, _c;
        // 归属校验：商品必须属于当前渠道；分类须为当前渠道或默认渠道（平台分类）
        await this.assertProductInChannel(ctx, productId);
        const repo = this.connection.getRepository(ctx, core_1.Collection);
        const collection = await repo.findOne({
            where: { id: String(collectionId) },
            relations: ['channels'],
        });
        if (!collection)
            return;
        await this.assertCollectionAccess(ctx, collection);
        // Vendure ConfigurableOperation 标准形态：{ code, args: [{name, value}] }，list 参数值存 JSON 字符串。
        const filters = (_a = collection.filters) !== null && _a !== void 0 ? _a : [];
        const productIdFilter = filters.find(f => f.code === 'product-id-filter');
        if (productIdFilter) {
            const idsArg = (_b = productIdFilter.args) === null || _b === void 0 ? void 0 : _b.find(a => a.name === 'productIds');
            const existing = this.parseIdList(idsArg === null || idsArg === void 0 ? void 0 : idsArg.value);
            if (!existing.includes(String(productId))) {
                const newValue = JSON.stringify([...existing, String(productId)]);
                if (idsArg) {
                    idsArg.value = newValue;
                }
                else {
                    (productIdFilter.args = (_c = productIdFilter.args) !== null && _c !== void 0 ? _c : []).push({
                        name: 'productIds',
                        value: newValue,
                    });
                }
            }
        }
        else {
            filters.push({
                code: 'product-id-filter',
                args: [
                    { name: 'productIds', value: JSON.stringify([String(productId)]) },
                    { name: 'combineWithAnd', value: 'false' },
                ],
            });
        }
        // 用 repo.update 显式只更新 filters 列（无条件发 UPDATE，绕开 TypeORM save() 对 simple-json 的引用级脏检测，确保真正持久化）。
        await repo.update(collection.id, { filters });
        // 重新计算该分类的变体成员，使商品立即出现在分类列表页（等价 updateCollection 的 applyCollectionFilters）。
        await this.collectionService.triggerApplyFiltersJob(ctx, {
            collectionIds: [collection.id],
        });
    }
    /**
     * 把商品挂到租户渠道并从默认渠道摘除（双轨隔离）。
     * 不能走 removeProductsFromChannel（会被「默认渠道不可摘除」守卫拦），须直接 channelService.removeFromChannels。
     */
    async moveProductsToTenantChannel(ctx, productIds, channelId) {
        // 目标渠道必须在操作者权限范围内（或超管）
        this.assertChannelAccess(ctx, channelId);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const channel = await this.channelService.findOne(ctx, channelId);
        if (!channel)
            throw new core_1.InternalServerError(`Channel not found: ${channelId}`);
        const result = [];
        for (const id of productIds) {
            // 商品必须属于当前渠道，防止把别店商品挂进本店 / 从默认渠道摘除
            await this.assertProductInChannel(ctx, id);
            if (!(0, core_1.idsAreEqual)(channel.id, defaultChannel.id)) {
                await this.channelService.assignToChannels(ctx, core_1.Product, id, [channel.id]);
            }
            await this.channelService.removeFromChannels(ctx, core_1.Product, id, [defaultChannel.id]);
            const p = await this.connection
                .getRepository(ctx, core_1.Product)
                .findOne({ where: { id: String(id) } });
            if (p)
                result.push(p);
        }
        return result;
    }
};
exports.TenantCatalogService = TenantCatalogService;
exports.TenantCatalogService = TenantCatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.CollectionService,
        core_1.ChannelService,
        core_1.TransactionalConnection])
], TenantCatalogService);
//# sourceMappingURL=tenant-catalog.service.js.map