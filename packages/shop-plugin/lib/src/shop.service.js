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
exports.ShopService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const review_plugin_1 = require("@vendure/review-plugin");
const typeorm_1 = require("typeorm");
const constants_1 = require("./constants");
const merchant_permissions_1 = require("./merchant-permissions");
const shop_entity_1 = require("./shop.entity");
/** 店铺状态合法迁移。single-direction：applicant→active→closed，允许重开/复审。 */
const ALLOWED_TRANSITIONS = {
    applicant: ['active', 'closed'],
    active: ['closed', 'applicant'],
    closed: ['active', 'applicant'],
};
let ShopService = class ShopService {
    constructor(connection, productService, administratorService, roleService, orderService) {
        this.connection = connection;
        this.productService = productService;
        this.administratorService = administratorService;
        this.roleService = roleService;
        this.orderService = orderService;
    }
    // ---------- 管理端 ----------
    async createShop(ctx, input) {
        var _a;
        await this.assertSlugUnique(ctx, input.slug);
        const repo = this.connection.getRepository(ctx, shop_entity_1.Shop);
        const existing = await repo.findOne({ where: { slug: input.slug } });
        if (existing) {
            throw new core_1.UserInputError(`Slug "${input.slug}" already in use`);
        }
        const shop = new shop_entity_1.Shop({
            name: input.name,
            slug: input.slug,
            logoAssetId: input.logoAssetId != null ? Number(input.logoAssetId) : null,
            bannerAssetId: input.bannerAssetId != null ? Number(input.bannerAssetId) : null,
            description: (_a = input.description) !== null && _a !== void 0 ? _a : null,
            status: 'applicant',
            channelId: ctx.channelId,
        });
        shop.channels = [ctx.channel];
        return repo.save(shop);
    }
    async updateShop(ctx, id, input) {
        var _a;
        const shop = await this.getEntityOrThrow(ctx, id);
        if (input.slug != null && input.slug !== shop.slug) {
            await this.assertSlugUnique(ctx, input.slug, id);
            shop.slug = input.slug;
        }
        if (input.name != null)
            shop.name = input.name;
        if (input.logoAssetId !== undefined) {
            shop.logoAssetId = input.logoAssetId != null ? Number(input.logoAssetId) : null;
        }
        if (input.bannerAssetId !== undefined) {
            shop.bannerAssetId = input.bannerAssetId != null ? Number(input.bannerAssetId) : null;
        }
        if (input.description !== undefined)
            shop.description = (_a = input.description) !== null && _a !== void 0 ? _a : null;
        return this.connection.getRepository(ctx, shop_entity_1.Shop).save(shop);
    }
    async setShopStatus(ctx, id, status) {
        var _a;
        const shop = await this.getEntityOrThrow(ctx, id);
        if (!status || !['applicant', 'active', 'closed'].includes(status)) {
            throw new core_1.UserInputError(`Invalid shop status "${status}"`);
        }
        const allowed = (_a = ALLOWED_TRANSITIONS[shop.status]) !== null && _a !== void 0 ? _a : [];
        if (!allowed.includes(status)) {
            throw new core_1.UserInputError(`Cannot transition shop status from "${shop.status}" to "${status}"`);
        }
        shop.status = status;
        const saved = await this.connection.getRepository(ctx, shop_entity_1.Shop).save(shop);
        await this.recomputeShopRating(ctx, saved.id);
        return saved;
    }
    async assignProductsToShop(ctx, input) {
        var _a;
        const shopId = Number(input.shopId);
        await this.getEntityOrThrow(ctx, shopId);
        const repo = this.connection.getRepository(ctx, core_1.Product);
        for (const pid of input.productIds) {
            const product = await repo.findOne({ where: { id: Number(pid) } });
            if (!product) {
                throw new core_1.EntityNotFoundError('Product', pid);
            }
            product.customFields = Object.assign(Object.assign({}, ((_a = product.customFields) !== null && _a !== void 0 ? _a : {})), { shopId });
            await repo.save(product);
        }
        await this.recomputeShopRating(ctx, shopId);
        return true;
    }
    async unassignProductsFromShop(ctx, input) {
        var _a;
        const shopId = Number(input.shopId);
        const repo = this.connection.getRepository(ctx, core_1.Product);
        for (const pid of input.productIds) {
            const product = await repo.findOne({ where: { id: Number(pid) } });
            if (!product)
                continue;
            product.customFields = Object.assign(Object.assign({}, ((_a = product.customFields) !== null && _a !== void 0 ? _a : {})), { shopId: null });
            await repo.save(product);
        }
        await this.recomputeShopRating(ctx, shopId);
        return true;
    }
    /** 管理端列表（全部状态）。 */
    async shops(ctx, options) {
        return this.connection.getRepository(ctx, shop_entity_1.Shop).find({
            where: { channelId: ctx.channelId },
            skip: options === null || options === void 0 ? void 0 : options.skip,
            take: options === null || options === void 0 ? void 0 : options.take,
            order: { createdAt: 'ASC' },
        });
    }
    async getShop(ctx, id) {
        return this.getEntityOrThrow(ctx, id);
    }
    // ---------- C 端 ----------
    /** C 端列表：仅 active 店铺。 */
    async getActiveShops(ctx, options) {
        return this.connection.getRepository(ctx, shop_entity_1.Shop).find({
            where: { channelId: ctx.channelId, status: 'active' },
            skip: options === null || options === void 0 ? void 0 : options.skip,
            take: options === null || options === void 0 ? void 0 : options.take,
            order: { createdAt: 'ASC' },
        });
    }
    /** C 端店铺主页：仅 active 对外；slug 不存在或非 active 返回 undefined（Query 返回 nullable）。 */
    async getShopBySlug(ctx, slug) {
        const shop = await this.connection
            .getRepository(ctx, shop_entity_1.Shop)
            .findOne({ where: { slug, status: 'active' } });
        return shop !== null && shop !== void 0 ? shop : undefined;
    }
    /** 店铺商品分页列表：按 Product.customFields.shopId 过滤（marketplace 同款写法）。 */
    async getShopProducts(ctx, shopId, options) {
        const lookupId = Number(shopId);
        const [items, totalItems] = await this.connection
            .getRepository(ctx, core_1.Product)
            .findAndCount({
            where: { customFields: { shopId: lookupId } },
            skip: options === null || options === void 0 ? void 0 : options.skip,
            take: options === null || options === void 0 ? void 0 : options.take,
            order: { id: 'ASC' },
        });
        return { items, totalItems };
    }
    /** 店铺评分（实时口径）：聚合归属商品的 reviewRating/reviewCount。始终正确。 */
    async getShopRating(ctx, shopId) {
        var _a, _b, _c;
        const products = await this.connection.getRepository(ctx, core_1.Product).find({
            where: { customFields: { shopId: Number(shopId) } },
        });
        const productCount = products.length;
        let reviewCount = 0;
        let weightedSum = 0;
        for (const p of products) {
            const cf = ((_a = p.customFields) !== null && _a !== void 0 ? _a : {});
            const rc = (_b = cf.reviewCount) !== null && _b !== void 0 ? _b : 0;
            const rating = (_c = cf.reviewRating) !== null && _c !== void 0 ? _c : 0;
            reviewCount += rc;
            weightedSum += rating * rc;
        }
        const rating = reviewCount === 0 ? 0 : Math.round((weightedSum / reviewCount) * 10) / 10;
        return { rating, reviewCount, productCount };
    }
    /** 重算店铺评分并写回 Shop 缓存列（列表/店铺页读取，避免 N+1）。 */
    async recomputeShopRating(ctx, shopId) {
        const shop = await this.getEntityOrThrow(ctx, shopId);
        const snapshot = await this.getShopRating(ctx, shopId);
        shop.shopRating = snapshot.rating;
        shop.shopReviewCount = snapshot.reviewCount;
        shop.shopProductCount = snapshot.productCount;
        return this.connection.getRepository(ctx, shop_entity_1.Shop).save(shop);
    }
    /** 读店铺缓存评分（供 ResolveField）；无缓存时回退实时计算。 */
    async getShopRatingCachedOrCompute(ctx, shop) {
        var _a, _b;
        if (shop.shopRating != null) {
            return {
                rating: shop.shopRating,
                reviewCount: (_a = shop.shopReviewCount) !== null && _a !== void 0 ? _a : 0,
                productCount: (_b = shop.shopProductCount) !== null && _b !== void 0 ? _b : 0,
            };
        }
        return this.getShopRating(ctx, shop.id);
    }
    // ---------- 店主自营后台（阶段18） ----------
    /**
     * 归属解析：activeUserId → Administrator.user → Shop.administratorId（优先）。
     * 渠道回退：管理员无绑定店铺（平台/superadmin 按城市选店场景）时，按当前经营渠道
     * ctx.channelId 解析该渠道 active 店铺，使 web-admin 的「本店商品单/统计」可用。
     * 多店并存渠道取首个，语义为「本渠道本店」（当前为单店/渠道模型）。
     */
    async resolveMyShopFromActiveUser(ctx) {
        if (!ctx.activeUserId) {
            return undefined;
        }
        const admin = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
        if (!admin || admin.id == null) {
            return undefined;
        }
        const bound = await this.connection
            .getRepository(ctx, shop_entity_1.Shop)
            .findOne({ where: { administratorId: admin.id } });
        if (bound) {
            return bound;
        }
        const byChannel = await this.connection
            .getRepository(ctx, shop_entity_1.Shop)
            .findOne({ where: { channelId: ctx.channelId, status: 'active' }, order: { id: 'ASC' } });
        return byChannel !== null && byChannel !== void 0 ? byChannel : undefined;
    }
    /** 店主后台入口守卫：无归属店铺或店铺非 active → Forbidden（关闭店铺即冻结）。 */
    async requireMyShop(ctx) {
        const shop = await this.resolveMyShopFromActiveUser(ctx);
        if (!shop || shop.status !== 'active') {
            throw new core_1.ForbiddenError();
        }
        return shop;
    }
    /** 平台开通店主账号：幂等建 Role + Administrator + 写 Shop.administratorId。 */
    async provisionShopOwner(ctx, shopId, input) {
        var _a, _b;
        const shop = await this.getEntityOrThrow(ctx, shopId);
        if (shop.administratorId != null) {
            const existing = await this.administratorService.findOne(ctx, shop.administratorId);
            if (existing) {
                return existing;
            }
        }
        const role = await this.ensureShopOwnerRole(ctx);
        const administrator = await this.administratorService.create(ctx, {
            firstName: (_a = input.firstName) !== null && _a !== void 0 ? _a : '',
            lastName: (_b = input.lastName) !== null && _b !== void 0 ? _b : '',
            emailAddress: input.emailAddress,
            password: input.password,
            roleIds: [role.id],
        });
        shop.administratorId = administrator.id;
        await this.connection.getRepository(ctx, shop_entity_1.Shop).save(shop);
        return administrator;
    }
    async ensureShopOwnerRole(ctx) {
        const existing = await this.connection
            .getRepository(ctx, core_1.Role)
            .findOne({ where: { code: constants_1.SHOP_OWNER_ROLE_CODE } });
        if (existing) {
            return existing;
        }
        return this.roleService.create(ctx, {
            code: constants_1.SHOP_OWNER_ROLE_CODE,
            description: 'Shop owner with access to manage their own shop',
            channelIds: [ctx.channelId],
            permissions: [merchant_permissions_1.manageOwnShop.Permission, core_1.Permission.ReadPromotion, 'TenantSettingsManage'],
        });
    }
    async updateMyShop(ctx, input) {
        var _a;
        const shop = await this.requireMyShop(ctx);
        if (input.name != null)
            shop.name = input.name;
        if (input.logoAssetId !== undefined) {
            shop.logoAssetId = input.logoAssetId != null ? Number(input.logoAssetId) : null;
        }
        if (input.bannerAssetId !== undefined) {
            shop.bannerAssetId = input.bannerAssetId != null ? Number(input.bannerAssetId) : null;
        }
        if (input.description !== undefined)
            shop.description = (_a = input.description) !== null && _a !== void 0 ? _a : null;
        return this.connection.getRepository(ctx, shop_entity_1.Shop).save(shop);
    }
    async getMyShopProducts(ctx, options) {
        const shop = await this.requireMyShop(ctx);
        return this.getShopProducts(ctx, shop.id, options);
    }
    async addProductToMyShop(ctx, productId) {
        var _a, _b, _c;
        const shop = await this.requireMyShop(ctx);
        const product = await this.connection
            .getRepository(ctx, core_1.Product)
            .findOne({ where: { id: Number(productId) } });
        if (!product) {
            throw new core_1.EntityNotFoundError('Product', productId);
        }
        const currentShopId = (_b = ((_a = product.customFields) !== null && _a !== void 0 ? _a : {}).shopId) !== null && _b !== void 0 ? _b : null;
        if (currentShopId != null && Number(currentShopId) !== shop.id) {
            throw new core_1.UserInputError('Product is already assigned to another shop');
        }
        product.customFields = Object.assign(Object.assign({}, ((_c = product.customFields) !== null && _c !== void 0 ? _c : {})), { shopId: shop.id });
        await this.connection.getRepository(ctx, core_1.Product).save(product);
        await this.recomputeShopRating(ctx, shop.id);
        return true;
    }
    async removeProductFromMyShop(ctx, productId) {
        var _a;
        const shop = await this.requireMyShop(ctx);
        const product = await this.getMyShopProductOrThrow(ctx, shop, productId);
        product.customFields = Object.assign(Object.assign({}, ((_a = product.customFields) !== null && _a !== void 0 ? _a : {})), { shopId: null });
        await this.connection.getRepository(ctx, core_1.Product).save(product);
        await this.recomputeShopRating(ctx, shop.id);
        return true;
    }
    async updateMyShopProduct(ctx, productId, input) {
        var _a, _b, _c;
        const shop = await this.requireMyShop(ctx);
        const product = await this.getMyShopProductOrThrow(ctx, shop, productId);
        // Product.translations 关系无 cascade，需直接持久化 translation 子实体（与 core ProductService 一致）。
        const translations = (_a = product.translations) !== null && _a !== void 0 ? _a : [];
        const target = (_b = translations.find(t => t.languageCode === ctx.languageCode)) !== null && _b !== void 0 ? _b : translations[0];
        if (!target) {
            throw new core_1.UserInputError('Product has no translations to update');
        }
        if (input.name != null)
            target.name = input.name;
        if (input.description != null)
            target.description = (_c = input.description) !== null && _c !== void 0 ? _c : '';
        await this.connection.getRepository(ctx, core_1.ProductTranslation).save(target);
        return this.connection
            .getRepository(ctx, core_1.Product)
            .findOne({ where: { id: product.id }, relations: ['translations'] });
    }
    /**
     * 上下架：切换本人店铺商品的 Product.enabled 并同步其全部变体 ProductVariant.enabled。
     * 归属：getMyShopProductOrThrow 校验商品属于本人店铺。
     */
    async setMyShopProductEnabled(ctx, productId, enabled) {
        const shop = await this.requireMyShop(ctx);
        const product = await this.getMyShopProductOrThrow(ctx, shop, productId);
        product.enabled = enabled;
        await this.connection.getRepository(ctx, core_1.Product).save(product);
        const variants = await this.connection.getRepository(ctx, core_1.ProductVariant).find({
            where: { product: { id: product.id } },
        });
        for (const v of variants) {
            v.enabled = enabled;
            await this.connection.getRepository(ctx, core_1.ProductVariant).save(v);
        }
        return true;
    }
    async getMyShopOrders(ctx) {
        const shop = await this.requireMyShop(ctx);
        return this.aggregateMerchantOrders(ctx, shop);
    }
    async getMyShopOrder(ctx, orderId) {
        var _a;
        const shop = await this.requireMyShop(ctx);
        const all = await this.aggregateMerchantOrders(ctx, shop);
        return (_a = all.find(m => String(m.orderId) === String(orderId))) !== null && _a !== void 0 ? _a : undefined;
    }
    /**
     * 店主发货：对该订单中归属本店、且尚未履约的行创建 manual Fulfillment 并流转至 Shipped。
     * 已履约完的行跳过；全部已履约则直接返回摘要不发重复货。
     */
    async fulfillMyShopOrder(ctx, orderId, method, trackingCode, lines) {
        var _a, _b;
        const shop = await this.requireMyShop(ctx);
        const { myLines, orderHasLines } = await this.resolveMyShopOrder(ctx, orderId, shop);
        // 越权隔离：订单确有行但无一属于本店 → 属他人店铺订单，直接拒绝（勿静默返回空）。
        if (orderHasLines && myLines.length === 0) {
            throw new core_1.ForbiddenError();
        }
        // 分批配送：传入 lines 则只发指定行/数量（按 remaining 截断），不传则本店剩余行全发。
        const toFulfill = this.pickToFulfill(myLines, lines);
        const fulfillmentIds = [];
        if (toFulfill.length > 0) {
            const fulfillment = await this.orderService.createFulfillment(ctx, {
                handler: {
                    code: 'manual-fulfillment',
                    arguments: [
                        { name: 'method', value: method !== null && method !== void 0 ? method : '' },
                        { name: 'trackingCode', value: trackingCode !== null && trackingCode !== void 0 ? trackingCode : '' },
                    ],
                },
                lines: toFulfill,
            });
            if (!fulfillment || 'errorCode' in fulfillment) {
                throw new core_1.UserInputError((_a = fulfillment === null || fulfillment === void 0 ? void 0 : fulfillment.message) !== null && _a !== void 0 ? _a : '创建发货单失败');
            }
            const promoted = await this.orderService.transitionFulfillmentToState(ctx, fulfillment.id, 'Shipped');
            if (!promoted || 'errorCode' in promoted) {
                throw new core_1.UserInputError((_b = promoted === null || promoted === void 0 ? void 0 : promoted.message) !== null && _b !== void 0 ? _b : '发货单流转失败');
            }
            fulfillmentIds.push(String(fulfillment.id));
        }
        // 结果按订单本店行整体口径：shipped = 已履约总和、remaining = 未履约总和。
        // shipBefore 是本调用前的已履约量，叠加本次 toFulfill 数量得出新口径（resolve 时尚未落库）。
        const totalQuantity = myLines.reduce((acc, l) => acc + l.line.quantity, 0);
        const totalRemaining = myLines.reduce((acc, l) => acc + l.remaining, 0);
        const shippedBefore = totalQuantity - totalRemaining;
        const shippedNow = shippedBefore + toFulfill.reduce((acc, l) => acc + l.quantity, 0);
        return {
            orderId: String(orderId),
            totalItemCount: totalQuantity,
            shippedItemCount: shippedNow,
            remainingItemCount: totalQuantity - shippedNow,
            fulfillmentIds,
        };
    }
    /**
     * 筛选本次要发货的行/数量。传 lines 则只发命中本店、且 quantity>0 的行（量超 remaining 截断）；
     * 否则把本店所有 remaining>0 的行按剩余量一次发出。
     */
    pickToFulfill(myLines, lines) {
        if (lines && lines.length > 0) {
            const requested = new Map(lines.map(l => [String(l.orderLineId), l.quantity]));
            return myLines
                .filter(l => requested.has(String(l.line.id)))
                .filter(l => l.remaining > 0)
                .map(l => ({
                orderLineId: String(l.line.id),
                quantity: Math.min(requested.get(String(l.line.id)), l.remaining),
            }))
                .filter(p => p.quantity > 0);
        }
        return myLines
            .filter(l => l.remaining > 0)
            .map(l => ({ orderLineId: String(l.line.id), quantity: l.remaining }));
    }
    /** 店主查看该订单本店行的发货单列表（state!=Cancelled）。 */
    async getMyShopOrderFulfillments(ctx, orderId) {
        var _a, _b;
        const shop = await this.requireMyShop(ctx);
        const { myLines, nameByLine } = await this.resolveMyShopOrder(ctx, orderId, shop);
        const ids = myLines.map(l => l.line.id);
        if (ids.length === 0) {
            return [];
        }
        const fls = await this.connection
            .getRepository(ctx, core_1.FulfillmentLine)
            .createQueryBuilder('fl')
            .leftJoinAndSelect('fl.fulfillment', 'fulfillment')
            .where('fl.orderLineId IN (:...ids)', { ids })
            .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
            .orderBy('fulfillment.createdAt', 'ASC')
            .getMany();
        const grouped = new Map();
        for (const fl of fls) {
            const fid = fl.fulfillment.id;
            const f = grouped.get(fid);
            if (f) {
                f.items.push(Object.assign(Object.assign({ orderLineId: String(fl.orderLineId) }, nameByLine.get(fl.orderLineId)), { quantity: fl.quantity }));
                continue;
            }
            grouped.set(fid, {
                fulfillmentId: String(fid),
                state: fl.fulfillment.state,
                method: (_a = fl.fulfillment.method) !== null && _a !== void 0 ? _a : null,
                trackingCode: (_b = fl.fulfillment.trackingCode) !== null && _b !== void 0 ? _b : null,
                createdAt: fl.fulfillment.createdAt,
                items: [
                    Object.assign(Object.assign({ orderLineId: String(fl.orderLineId) }, nameByLine.get(fl.orderLineId)), { quantity: fl.quantity }),
                ],
            });
        }
        return [...grouped.values()];
    }
    /**
     * 解析指定订单中归属本店的行及其履约量。
     * 返回：myLines（line + fulfilled + remaining）、总产量、nameByLine（orderLineId→商品/变体名）。
     */
    async resolveMyShopOrder(ctx, orderId, shop) {
        var _a, _b, _c, _d, _e, _f, _g;
        const order = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { id: Number(orderId) },
            relations: [
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
                'lines.productVariant.translations',
                'lines.productVariant.product.translations',
            ],
        });
        if (!order) {
            throw new core_1.EntityNotFoundError('Order', orderId);
        }
        const orderHasLines = ((_b = (_a = order.lines) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0;
        const myLines = ((_c = order.lines) !== null && _c !== void 0 ? _c : []).filter(l => {
            var _a, _b, _c;
            const cf = ((_c = (_b = (_a = l.productVariant) === null || _a === void 0 ? void 0 : _a.product) === null || _b === void 0 ? void 0 : _b.customFields) !== null && _c !== void 0 ? _c : {});
            return Number(cf.shopId) === shop.id;
        });
        const ids = myLines.map(l => l.id);
        const fulfilledMap = new Map();
        if (ids.length > 0) {
            const fls = await this.connection
                .getRepository(ctx, core_1.FulfillmentLine)
                .createQueryBuilder('fl')
                .leftJoinAndSelect('fl.fulfillment', 'fulfillment')
                .where('fl.orderLineId IN (:...ids)', { ids })
                .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
                .getMany();
            for (const fl of fls) {
                fulfilledMap.set(fl.orderLineId, ((_d = fulfilledMap.get(fl.orderLineId)) !== null && _d !== void 0 ? _d : 0) + fl.quantity);
            }
        }
        const nameByLine = new Map();
        for (const l of myLines) {
            const pvName = this.pickName((_e = l.productVariant) === null || _e === void 0 ? void 0 : _e.translations, ctx.languageCode, 'name');
            const pName = this.pickName((_g = (_f = l.productVariant) === null || _f === void 0 ? void 0 : _f.product) === null || _g === void 0 ? void 0 : _g.translations, ctx.languageCode, 'name');
            nameByLine.set(l.id, { productName: pName, variantName: pvName });
        }
        return {
            myLines: myLines.map(l => {
                var _a;
                const total = l.quantity;
                const fulfilled = (_a = fulfilledMap.get(l.id)) !== null && _a !== void 0 ? _a : 0;
                return { line: l, remaining: total - fulfilled };
            }),
            nameByLine,
            orderHasLines,
        };
    }
    async getMyShopReviews(ctx) {
        var _a;
        const shop = await this.requireMyShop(ctx);
        const productIds = await this.getMyShopProductIds(ctx, shop);
        if (productIds.length === 0) {
            return [];
        }
        const reviews = await this.connection.getRepository(ctx, review_plugin_1.Review).find({
            where: { productId: (0, typeorm_1.In)(productIds), parentId: (0, typeorm_1.IsNull)() },
            order: { createdAt: 'DESC' },
        });
        const names = await this.loadProductNames(ctx, productIds);
        const result = [];
        for (const r of reviews) {
            const customerName = await this.loadCustomerName(ctx, r.customerId);
            result.push({
                reviewId: String(r.id),
                productId: String(r.productId),
                productName: (_a = names.get(r.productId)) !== null && _a !== void 0 ? _a : '',
                rating: r.rating,
                content: r.content,
                status: r.status,
                customerName,
                createdAt: r.createdAt,
            });
        }
        return result;
    }
    async approveMerchantReview(ctx, id) {
        const shop = await this.requireMyShop(ctx);
        const review = await this.assertMyReview(ctx, shop, id);
        review.status = 'approved';
        await this.connection.getRepository(ctx, review_plugin_1.Review).save(review);
        if (!review.parentId) {
            await this.recomputeMerchantProductRating(ctx, review.productId);
        }
        return true;
    }
    async rejectMerchantReview(ctx, id) {
        const shop = await this.requireMyShop(ctx);
        const review = await this.assertMyReview(ctx, shop, id);
        const wasApprovedRoot = review.status === 'approved' && !review.parentId;
        review.status = 'rejected';
        await this.connection.getRepository(ctx, review_plugin_1.Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeMerchantProductRating(ctx, review.productId);
        }
        return true;
    }
    /** 重算单个商品评分聚合（approved 主评加权，与 review-plugin 同口径）并写回 Product.customFields + 店铺评分缓存。 */
    async recomputeMerchantProductRating(ctx, productId) {
        var _a, _b, _c;
        const reviews = await this.connection.getRepository(ctx, review_plugin_1.Review).find({
            where: { productId, status: 'approved', parentId: (0, typeorm_1.IsNull)() },
        });
        const reviewCount = reviews.length;
        const rating = reviewCount === 0
            ? 0
            : Math.round((reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount) * 10) / 10;
        const product = await this.connection
            .getRepository(ctx, core_1.Product)
            .findOne({ where: { id: productId } });
        if (!product) {
            return;
        }
        product.customFields = Object.assign(Object.assign({}, ((_a = product.customFields) !== null && _a !== void 0 ? _a : {})), { reviewRating: rating, reviewCount });
        await this.connection.getRepository(ctx, core_1.Product).save(product);
        const shopId = (_c = ((_b = product.customFields) !== null && _b !== void 0 ? _b : {}).shopId) !== null && _c !== void 0 ? _c : null;
        if (shopId != null) {
            await this.recomputeShopRating(ctx, Number(shopId));
        }
    }
    // ---------- 店主域私有助手 ----------
    async getMyShopProductIds(ctx, shop) {
        const products = await this.connection.getRepository(ctx, core_1.Product).find({
            where: { customFields: { shopId: shop.id } },
            select: ['id'],
        });
        return products.map(p => p.id);
    }
    async getMyShopProductOrThrow(ctx, shop, productId) {
        const product = await this.connection.getRepository(ctx, core_1.Product).findOne({
            where: { id: Number(productId), customFields: { shopId: shop.id } },
            relations: ['translations'],
        });
        if (!product) {
            throw new core_1.ForbiddenError();
        }
        return product;
    }
    async loadProductNames(ctx, productIds) {
        var _a, _b, _c, _d;
        const map = new Map();
        if (productIds.length === 0) {
            return map;
        }
        const products = await this.connection.getRepository(ctx, core_1.Product).find({
            where: { id: (0, typeorm_1.In)(productIds) },
            relations: ['translations'],
        });
        for (const p of products) {
            const t = (_b = ((_a = p.translations) !== null && _a !== void 0 ? _a : []).find(tr => tr.languageCode === ctx.languageCode)) !== null && _b !== void 0 ? _b : ((_c = p.translations) !== null && _c !== void 0 ? _c : [])[0];
            map.set(p.id, (_d = t === null || t === void 0 ? void 0 : t.name) !== null && _d !== void 0 ? _d : '');
        }
        return map;
    }
    async loadCustomerName(ctx, customerId) {
        try {
            const customer = await this.connection.getEntityOrThrow(ctx, core_1.Customer, customerId);
            return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.emailAddress;
        }
        catch (_a) {
            return null;
        }
    }
    async assertMyReview(ctx, shop, id) {
        const review = await this.connection.getEntityOrThrow(ctx, review_plugin_1.Review, id);
        const productIds = await this.getMyShopProductIds(ctx, shop);
        if (!productIds.includes(review.productId)) {
            throw new core_1.ForbiddenError();
        }
        return review;
    }
    /** 聚合我店商品行 → MerchantOrder 投影（items 仅含我店行，不泄露他人店铺行）。e2e 规模用内存聚合。 */
    async aggregateMerchantOrders(ctx, shop) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const lines = await this.connection.getRepository(ctx, core_1.OrderLine).find({
            relations: [
                'order',
                'order.shippingLines',
                'order.shippingLines.shippingMethod',
                'order.customer',
                'productVariant',
                'productVariant.product',
                'productVariant.translations',
                'productVariant.product.translations',
            ],
        });
        const myLines = lines.filter(l => {
            var _a, _b, _c;
            const cf = ((_c = (_b = (_a = l.productVariant) === null || _a === void 0 ? void 0 : _a.product) === null || _b === void 0 ? void 0 : _b.customFields) !== null && _c !== void 0 ? _c : {});
            return Number(cf.shopId) === shop.id;
        });
        // 逐行已履约量（非 Cancelled FulfillmentLine 求和），供店主列表显示已发/待发。
        const fulfilledByLine = new Map();
        if (myLines.length > 0) {
            const fls = await this.connection
                .getRepository(ctx, core_1.FulfillmentLine)
                .createQueryBuilder('fulfillmentLine')
                .leftJoinAndSelect('fulfillmentLine.fulfillment', 'fulfillment')
                .where('fulfillmentLine.orderLineId IN (:...ids)', {
                ids: myLines.map(l => l.id),
            })
                .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
                .getMany();
            for (const fl of fls) {
                const cur = (_a = fulfilledByLine.get(fl.orderLineId)) !== null && _a !== void 0 ? _a : 0;
                fulfilledByLine.set(fl.orderLineId, cur + fl.quantity);
            }
        }
        const orderMap = new Map();
        for (const line of myLines) {
            const order = line.order;
            if (!order) {
                continue;
            }
            const orderId = order.id;
            const existing = orderMap.get(orderId);
            const pv = line.productVariant;
            const product = pv === null || pv === void 0 ? void 0 : pv.product;
            const pvName = this.pickName(pv === null || pv === void 0 ? void 0 : pv.translations, ctx.languageCode, 'name');
            const pName = this.pickName(product === null || product === void 0 ? void 0 : product.translations, ctx.languageCode, 'name');
            if (existing) {
                existing.items.push({
                    orderLineId: String(line.id),
                    productId: product ? String(product.id) : '',
                    productName: pName,
                    variantName: pvName,
                    quantity: line.quantity,
                    fulfilledQuantity: (_b = fulfilledByLine.get(line.id)) !== null && _b !== void 0 ? _b : 0,
                    unitPriceWithTax: line.unitPriceWithTax,
                    lineTotalWithTax: line.linePriceWithTax,
                });
                existing.totalWithTax += line.linePriceWithTax;
                continue;
            }
            orderMap.set(orderId, {
                orderId: String(orderId),
                code: order.code,
                state: order.state,
                totalWithTax: line.linePriceWithTax,
                currencyCode: order.currencyCode,
                customerName: order.customer
                    ? [order.customer.firstName, order.customer.lastName].filter(Boolean).join(' ') ||
                        order.customer.emailAddress
                    : null,
                placedAt: (_c = order.orderPlacedAt) !== null && _c !== void 0 ? _c : null,
                shippingAddress: order.shippingAddress
                    ? {
                        fullName: (_d = order.shippingAddress.fullName) !== null && _d !== void 0 ? _d : null,
                        streetLine1: (_e = order.shippingAddress.streetLine1) !== null && _e !== void 0 ? _e : null,
                        city: (_f = order.shippingAddress.city) !== null && _f !== void 0 ? _f : null,
                        province: (_g = order.shippingAddress.province) !== null && _g !== void 0 ? _g : null,
                        countryCode: (_h = order.shippingAddress.countryCode) !== null && _h !== void 0 ? _h : null,
                        postalCode: (_j = order.shippingAddress.postalCode) !== null && _j !== void 0 ? _j : null,
                    }
                    : null,
                shippingLines: ((_k = order.shippingLines) !== null && _k !== void 0 ? _k : []).map(sl => {
                    var _a, _b, _c, _d;
                    return ({
                        id: String(sl.id),
                        code: (_b = (_a = sl.shippingMethod) === null || _a === void 0 ? void 0 : _a.code) !== null && _b !== void 0 ? _b : null,
                        name: (_d = (_c = sl.shippingMethod) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : null,
                    });
                }),
                items: [
                    {
                        orderLineId: String(line.id),
                        productId: product ? String(product.id) : '',
                        productName: pName,
                        variantName: pvName,
                        quantity: line.quantity,
                        fulfilledQuantity: (_l = fulfilledByLine.get(line.id)) !== null && _l !== void 0 ? _l : 0,
                        unitPriceWithTax: line.unitPriceWithTax,
                        lineTotalWithTax: line.linePriceWithTax,
                    },
                ],
            });
        }
        return [...orderMap.values()];
    }
    pickName(translations, lang, field) {
        var _a, _b;
        const tr = (_a = (translations !== null && translations !== void 0 ? translations : []).find(t => (t === null || t === void 0 ? void 0 : t.languageCode) === lang)) !== null && _a !== void 0 ? _a : (translations !== null && translations !== void 0 ? translations : [])[0];
        return (_b = tr === null || tr === void 0 ? void 0 : tr[field]) !== null && _b !== void 0 ? _b : '';
    }
    async assertSlugUnique(ctx, slug, excludeId) {
        const existing = await this.connection
            .getRepository(ctx, shop_entity_1.Shop)
            .findOne({ where: { slug } });
        if (existing && (!excludeId || existing.id !== Number(excludeId))) {
            throw new core_1.UserInputError(`Slug "${slug}" already in use`);
        }
    }
    async getEntityOrThrow(ctx, id) {
        return this.connection.getEntityOrThrow(ctx, shop_entity_1.Shop, id);
    }
};
exports.ShopService = ShopService;
exports.ShopService = ShopService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ProductService,
        core_1.AdministratorService,
        core_1.RoleService,
        core_1.OrderService])
], ShopService);
//# sourceMappingURL=shop.service.js.map