import { Injectable } from '@nestjs/common';
import {
    Administrator,
    AdministratorService,
    Customer,
    EntityNotFoundError,
    ForbiddenError,
    FulfillmentLine,
    ID,
    LanguageCode,
    Order,
    OrderLine,
    OrderService,
    PaginatedList,
    Permission,
    Product,
    ProductService,
    ProductTranslation,
    ProductVariant,
    RequestContext,
    Role,
    RoleService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { Review } from '@vendure/review-plugin';
import { In, IsNull } from 'typeorm';

import { loggerCtx, SHOP_OWNER_ROLE_CODE } from './constants';
import { manageOwnShop } from './merchant-permissions';
import { Shop } from './shop.entity';
import {
    AssignProductsInput,
    CreateOwnerInput,
    CreateShopInput,
    FulfillMyShopOrderResult,
    MerchantFulfillment,
    MerchantOrder,
    MerchantOrderLine,
    MerchantReview,
    ShopListOptions,
    ShopRating,
    ShopStatus,
    UpdateMyShopInput,
    UpdateMyShopProductInput,
    UpdateShopInput,
} from './types';

/** 店铺状态合法迁移。single-direction：applicant→active→closed，允许重开/复审。 */
const ALLOWED_TRANSITIONS: Record<string, ShopStatus[]> = {
    applicant: ['active', 'closed'],
    active: ['closed', 'applicant'],
    closed: ['active', 'applicant'],
};

@Injectable()
export class ShopService {
    constructor(
        private connection: TransactionalConnection,
        private productService: ProductService,
        private administratorService: AdministratorService,
        private roleService: RoleService,
        private orderService: OrderService,
    ) {}

    // ---------- 管理端 ----------

    async createShop(ctx: RequestContext, input: CreateShopInput): Promise<Shop> {
        await this.assertSlugUnique(ctx, input.slug);
        const repo = this.connection.getRepository(ctx, Shop);
        const existing = await repo.findOne({ where: { slug: input.slug } as any });
        if (existing) {
            throw new UserInputError(`Slug "${input.slug}" already in use`);
        }
        const shop = new Shop({
            name: input.name,
            slug: input.slug,
            logoAssetId: input.logoAssetId != null ? Number(input.logoAssetId) : null,
            bannerAssetId: input.bannerAssetId != null ? Number(input.bannerAssetId) : null,
            description: input.description ?? null,
            status: 'applicant',
            channelId: ctx.channelId as number,
        } as any);
        shop.channels = [ctx.channel];
        return repo.save(shop);
    }

    async updateShop(ctx: RequestContext, id: ID, input: UpdateShopInput): Promise<Shop> {
        const shop = await this.getEntityOrThrow(ctx, id);
        if (input.slug != null && input.slug !== shop.slug) {
            await this.assertSlugUnique(ctx, input.slug, id);
            shop.slug = input.slug;
        }
        if (input.name != null) shop.name = input.name;
        if (input.logoAssetId !== undefined) {
            shop.logoAssetId = input.logoAssetId != null ? Number(input.logoAssetId) : null;
        }
        if (input.bannerAssetId !== undefined) {
            shop.bannerAssetId = input.bannerAssetId != null ? Number(input.bannerAssetId) : null;
        }
        if (input.description !== undefined) shop.description = input.description ?? null;
        return this.connection.getRepository(ctx, Shop).save(shop);
    }

    async setShopStatus(ctx: RequestContext, id: ID, status: ShopStatus): Promise<Shop> {
        const shop = await this.getEntityOrThrow(ctx, id);
        if (!status || !['applicant', 'active', 'closed'].includes(status)) {
            throw new UserInputError(`Invalid shop status "${status}"`);
        }
        const allowed = ALLOWED_TRANSITIONS[shop.status] ?? [];
        if (!allowed.includes(status)) {
            throw new UserInputError(`Cannot transition shop status from "${shop.status}" to "${status}"`);
        }
        shop.status = status;
        const saved = await this.connection.getRepository(ctx, Shop).save(shop);
        await this.recomputeShopRating(ctx, saved.id as number);
        return saved;
    }

    async assignProductsToShop(ctx: RequestContext, input: AssignProductsInput): Promise<boolean> {
        const shopId = Number(input.shopId);
        await this.getEntityOrThrow(ctx, shopId);
        const repo = this.connection.getRepository(ctx, Product);
        for (const pid of input.productIds) {
            const product = await repo.findOne({ where: { id: Number(pid) } as any });
            if (!product) {
                throw new EntityNotFoundError('Product', pid);
            }
            product.customFields = {
                ...(product.customFields ?? {}),
                shopId,
            } as any;
            await repo.save(product);
        }
        await this.recomputeShopRating(ctx, shopId);
        return true;
    }

    async unassignProductsFromShop(ctx: RequestContext, input: AssignProductsInput): Promise<boolean> {
        const shopId = Number(input.shopId);
        const repo = this.connection.getRepository(ctx, Product);
        for (const pid of input.productIds) {
            const product = await repo.findOne({ where: { id: Number(pid) } as any });
            if (!product) continue;
            product.customFields = {
                ...(product.customFields ?? {}),
                shopId: null,
            } as any;
            await repo.save(product);
        }
        await this.recomputeShopRating(ctx, shopId);
        return true;
    }

    /** 管理端列表（全部状态）。 */
    async shops(ctx: RequestContext, options?: ShopListOptions): Promise<Shop[]> {
        return this.connection.getRepository(ctx, Shop).find({
            where: { channelId: ctx.channelId as number } as any,
            skip: options?.skip,
            take: options?.take,
            order: { createdAt: 'ASC' },
        });
    }

    async getShop(ctx: RequestContext, id: ID): Promise<Shop> {
        return this.getEntityOrThrow(ctx, id);
    }

    // ---------- C 端 ----------

    /** C 端列表：仅 active 店铺。 */
    async getActiveShops(ctx: RequestContext, options?: ShopListOptions): Promise<Shop[]> {
        return this.connection.getRepository(ctx, Shop).find({
            where: { channelId: ctx.channelId as number, status: 'active' } as any,
            skip: options?.skip,
            take: options?.take,
            order: { createdAt: 'ASC' },
        });
    }

    /** C 端店铺主页：仅 active 对外；slug 不存在或非 active 返回 undefined（Query 返回 nullable）。 */
    async getShopBySlug(ctx: RequestContext, slug: string): Promise<Shop | undefined> {
        const shop = await this.connection
            .getRepository(ctx, Shop)
            .findOne({ where: { slug, status: 'active' } as any });
        return shop ?? undefined;
    }

    /** 店铺商品分页列表：按 Product.customFields.shopId 过滤（marketplace 同款写法）。 */
    async getShopProducts(
        ctx: RequestContext,
        shopId: ID,
        options?: ShopListOptions,
    ): Promise<PaginatedList<Product>> {
        const lookupId = Number(shopId);
        const [items, totalItems] = await this.connection
            .getRepository(ctx, Product)
            .findAndCount({
                where: { customFields: { shopId: lookupId } as any },
                skip: options?.skip,
                take: options?.take,
                order: { id: 'ASC' },
            });
        return { items, totalItems };
    }

    /** 店铺评分（实时口径）：聚合归属商品的 reviewRating/reviewCount。始终正确。 */
    async getShopRating(ctx: RequestContext, shopId: ID): Promise<ShopRating> {
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { customFields: { shopId: Number(shopId) } as any },
        });
        const productCount = products.length;
        let reviewCount = 0;
        let weightedSum = 0;
        for (const p of products) {
            const cf = (p.customFields ?? {}) as any;
            const rc = cf.reviewCount ?? 0;
            const rating = cf.reviewRating ?? 0;
            reviewCount += rc;
            weightedSum += rating * rc;
        }
        const rating = reviewCount === 0 ? 0 : Math.round((weightedSum / reviewCount) * 10) / 10;
        return { rating, reviewCount, productCount };
    }

    /** 重算店铺评分并写回 Shop 缓存列（列表/店铺页读取，避免 N+1）。 */
    async recomputeShopRating(ctx: RequestContext, shopId: ID): Promise<Shop> {
        const shop = await this.getEntityOrThrow(ctx, shopId);
        const snapshot = await this.getShopRating(ctx, shopId);
        shop.shopRating = snapshot.rating;
        shop.shopReviewCount = snapshot.reviewCount;
        shop.shopProductCount = snapshot.productCount;
        return this.connection.getRepository(ctx, Shop).save(shop);
    }

    /** 读店铺缓存评分（供 ResolveField）；无缓存时回退实时计算。 */
    async getShopRatingCachedOrCompute(ctx: RequestContext, shop: Shop): Promise<ShopRating> {
        if (shop.shopRating != null) {
            return {
                rating: shop.shopRating,
                reviewCount: shop.shopReviewCount ?? 0,
                productCount: shop.shopProductCount ?? 0,
            };
        }
        return this.getShopRating(ctx, shop.id as number);
    }

    // ---------- 店主自营后台（阶段18） ----------

    /**
     * 归属解析：activeUserId → Administrator.user → Shop.administratorId（优先）。
     * 渠道回退：管理员无绑定店铺（平台/superadmin 按城市选店场景）时，按当前经营渠道
     * ctx.channelId 解析该渠道 active 店铺，使 web-admin 的「本店商品单/统计」可用。
     * 多店并存渠道取首个，语义为「本渠道本店」（当前为单店/渠道模型）。
     */
    async resolveMyShopFromActiveUser(ctx: RequestContext): Promise<Shop | undefined> {
        if (!ctx.activeUserId) {
            return undefined;
        }
        const admin = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
        if (!admin || admin.id == null) {
            return undefined;
        }
        const bound = await this.connection
            .getRepository(ctx, Shop)
            .findOne({ where: { administratorId: admin.id as number } as any });
        if (bound) {
            return bound;
        }
        const byChannel = await this.connection
            .getRepository(ctx, Shop)
            .findOne({ where: { channelId: ctx.channelId as number, status: 'active' } as any, order: { id: 'ASC' } as any });
        return byChannel ?? undefined;
    }

    /** 店主后台入口守卫：无归属店铺或店铺非 active → Forbidden（关闭店铺即冻结）。 */
    async requireMyShop(ctx: RequestContext): Promise<Shop> {
        const shop = await this.resolveMyShopFromActiveUser(ctx);
        if (!shop || shop.status !== 'active') {
            throw new ForbiddenError();
        }
        return shop;
    }

    /** 平台开通店主账号：幂等建 Role + Administrator + 写 Shop.administratorId。 */
    async provisionShopOwner(ctx: RequestContext, shopId: ID, input: CreateOwnerInput): Promise<Administrator> {
        const shop = await this.getEntityOrThrow(ctx, shopId);
        if (shop.administratorId != null) {
            const existing = await this.administratorService.findOne(ctx, shop.administratorId);
            if (existing) {
                return existing;
            }
        }
        const role = await this.ensureShopOwnerRole(ctx);
        const administrator = await this.administratorService.create(ctx, {
            firstName: input.firstName ?? '',
            lastName: input.lastName ?? '',
            emailAddress: input.emailAddress,
            password: input.password,
            roleIds: [role.id as ID],
        });
        shop.administratorId = administrator.id as number;
        await this.connection.getRepository(ctx, Shop).save(shop);
        return administrator;
    }

    private async ensureShopOwnerRole(ctx: RequestContext): Promise<Role> {
        const existing = await this.connection
            .getRepository(ctx, Role)
            .findOne({ where: { code: SHOP_OWNER_ROLE_CODE } as any });
        if (existing) {
            return existing;
        }
        return this.roleService.create(ctx, {
            code: SHOP_OWNER_ROLE_CODE,
            description: 'Shop owner with access to manage their own shop',
            channelIds: [ctx.channelId as ID],
            permissions: [
                manageOwnShop.Permission,
                Permission.ReadPromotion,
                'TenantSettingsManage' as Permission,
                // B2：店主可管理本渠道营销活动（写操作另有渠道归属校验）
                'TenantPromotionManage' as Permission,
            ],
        });
    }

    async updateMyShop(ctx: RequestContext, input: UpdateMyShopInput): Promise<Shop> {
        const shop = await this.requireMyShop(ctx);
        if (input.name != null) shop.name = input.name;
        if (input.logoAssetId !== undefined) {
            shop.logoAssetId = input.logoAssetId != null ? Number(input.logoAssetId) : null;
        }
        if (input.bannerAssetId !== undefined) {
            shop.bannerAssetId = input.bannerAssetId != null ? Number(input.bannerAssetId) : null;
        }
        if (input.description !== undefined) shop.description = input.description ?? null;
        return this.connection.getRepository(ctx, Shop).save(shop);
    }

    async getMyShopProducts(
        ctx: RequestContext,
        options?: ShopListOptions,
    ): Promise<PaginatedList<Product>> {
        const shop = await this.requireMyShop(ctx);
        return this.getShopProducts(ctx, shop.id as number, options);
    }

    async addProductToMyShop(ctx: RequestContext, productId: ID): Promise<boolean> {
        const shop = await this.requireMyShop(ctx);
        const product = await this.connection
            .getRepository(ctx, Product)
            .findOne({ where: { id: Number(productId) } as any });
        if (!product) {
            throw new EntityNotFoundError('Product', productId);
        }
        const currentShopId = ((product.customFields ?? {}) as any).shopId ?? null;
        if (currentShopId != null && Number(currentShopId) !== shop.id) {
            throw new UserInputError('Product is already assigned to another shop');
        }
        product.customFields = {
            ...(product.customFields ?? {}),
            shopId: shop.id as number,
        } as any;
        await this.connection.getRepository(ctx, Product).save(product);
        await this.recomputeShopRating(ctx, shop.id as number);
        return true;
    }

    async removeProductFromMyShop(ctx: RequestContext, productId: ID): Promise<boolean> {
        const shop = await this.requireMyShop(ctx);
        const product = await this.getMyShopProductOrThrow(ctx, shop, productId);
        product.customFields = {
            ...(product.customFields ?? {}),
            shopId: null,
        } as any;
        await this.connection.getRepository(ctx, Product).save(product);
        await this.recomputeShopRating(ctx, shop.id as number);
        return true;
    }

    async updateMyShopProduct(
        ctx: RequestContext,
        productId: ID,
        input: UpdateMyShopProductInput,
    ): Promise<Product> {
        const shop = await this.requireMyShop(ctx);
        const product = await this.getMyShopProductOrThrow(ctx, shop, productId);
        // Product.translations 关系无 cascade，需直接持久化 translation 子实体（与 core ProductService 一致）。
        const translations = product.translations ?? [];
        const target =
            translations.find(t => t.languageCode === ctx.languageCode) ?? translations[0];
        if (!target) {
            throw new UserInputError('Product has no translations to update');
        }
        if (input.name != null) target.name = input.name;
        if (input.description != null) target.description = input.description ?? '';
        await this.connection.getRepository(ctx, ProductTranslation).save(target);
        return this.connection
            .getRepository(ctx, Product)
            .findOne({ where: { id: product.id as number } as any, relations: ['translations'] }) as any;
    }

    /**
     * 上下架：切换本人店铺商品的 Product.enabled 并同步其全部变体 ProductVariant.enabled。
     * 归属：getMyShopProductOrThrow 校验商品属于本人店铺。
     */
    async setMyShopProductEnabled(
        ctx: RequestContext,
        productId: ID,
        enabled: boolean,
    ): Promise<boolean> {
        const shop = await this.requireMyShop(ctx);
        const product = await this.getMyShopProductOrThrow(ctx, shop, productId);
        product.enabled = enabled;
        await this.connection.getRepository(ctx, Product).save(product);
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { product: { id: product.id as number } } as any,
        });
        for (const v of variants) {
            v.enabled = enabled;
            await this.connection.getRepository(ctx, ProductVariant).save(v);
        }
        return true;
    }

    async getMyShopOrders(ctx: RequestContext): Promise<MerchantOrder[]> {
        const shop = await this.requireMyShop(ctx);
        return this.aggregateMerchantOrders(ctx, shop);
    }

    async getMyShopOrder(ctx: RequestContext, orderId: ID): Promise<MerchantOrder | undefined> {
        const shop = await this.requireMyShop(ctx);
        const all = await this.aggregateMerchantOrders(ctx, shop);
        return all.find(m => String(m.orderId) === String(orderId)) ?? undefined;
    }

    /**
     * 店主发货：对该订单中归属本店、且尚未履约的行创建 manual Fulfillment 并流转至 Shipped。
     * 已履约完的行跳过；全部已履约则直接返回摘要不发重复货。
     */
    async fulfillMyShopOrder(
        ctx: RequestContext,
        orderId: ID,
        method?: string,
        trackingCode?: string,
        lines?: Array<{ orderLineId: ID; quantity: number }>,
    ): Promise<FulfillMyShopOrderResult> {
        const shop = await this.requireMyShop(ctx);
        const { myLines, orderHasLines } = await this.resolveMyShopOrder(ctx, orderId, shop);
        // 越权隔离：订单确有行但无一属于本店 → 属他人店铺订单，直接拒绝（勿静默返回空）。
        if (orderHasLines && myLines.length === 0) {
            throw new ForbiddenError();
        }
        // 分批配送：传入 lines 则只发指定行/数量（按 remaining 截断），不传则本店剩余行全发。
        const toFulfill = this.pickToFulfill(myLines, lines);
        const fulfillmentIds: string[] = [];
        if (toFulfill.length > 0) {
            const fulfillment = await this.orderService.createFulfillment(ctx, {
                handler: {
                    code: 'manual-fulfillment',
                    arguments: [
                        { name: 'method', value: method ?? '' },
                        { name: 'trackingCode', value: trackingCode ?? '' },
                    ],
                },
                lines: toFulfill,
            });
            if (!fulfillment || 'errorCode' in (fulfillment as any)) {
                throw new UserInputError((fulfillment as any)?.message ?? '创建发货单失败');
            }
            const promoted = await this.orderService.transitionFulfillmentToState(
                ctx,
                (fulfillment as any).id,
                'Shipped' as any,
            );
            if (!promoted || 'errorCode' in (promoted as any)) {
                throw new UserInputError((promoted as any)?.message ?? '发货单流转失败');
            }
            fulfillmentIds.push(String((fulfillment as any).id));
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
    private pickToFulfill(
        myLines: Array<{ line: OrderLine; remaining: number }>,
        lines?: Array<{ orderLineId: ID; quantity: number }>,
    ): Array<{ orderLineId: string; quantity: number }> {
        if (lines && lines.length > 0) {
            const requested = new Map(lines.map(l => [String(l.orderLineId), l.quantity]));
            return myLines
                .filter(l => requested.has(String(l.line.id)))
                .filter(l => l.remaining > 0)
                .map(l => ({
                    orderLineId: String(l.line.id),
                    quantity: Math.min(requested.get(String(l.line.id))!, l.remaining),
                }))
                .filter(p => p.quantity > 0);
        }
        return myLines
            .filter(l => l.remaining > 0)
            .map(l => ({ orderLineId: String(l.line.id), quantity: l.remaining }));
    }

    /** 店主查看该订单本店行的发货单列表（state!=Cancelled）。 */
    async getMyShopOrderFulfillments(ctx: RequestContext, orderId: ID): Promise<MerchantFulfillment[]> {
        const shop = await this.requireMyShop(ctx);
        const { myLines, nameByLine } = await this.resolveMyShopOrder(ctx, orderId, shop);
        const ids = myLines.map(l => l.line.id as number);
        if (ids.length === 0) {
            return [];
        }
        const fls = await this.connection
            .getRepository(ctx, FulfillmentLine)
            .createQueryBuilder('fl')
            .leftJoinAndSelect('fl.fulfillment', 'fulfillment')
            .where('fl.orderLineId IN (:...ids)', { ids })
            .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
            .orderBy('fulfillment.createdAt', 'ASC')
            .getMany();
        const grouped = new Map<number, MerchantFulfillment>();
        for (const fl of fls) {
            const fid = fl.fulfillment.id as number;
            const f = grouped.get(fid);
            if (f) {
                f.items.push({
                    orderLineId: String(fl.orderLineId),
                    ...nameByLine.get(fl.orderLineId as number)!,
                    quantity: fl.quantity,
                });
                continue;
            }
            grouped.set(fid, {
                fulfillmentId: String(fid),
                state: fl.fulfillment.state as string,
                method: fl.fulfillment.method ?? null,
                trackingCode: fl.fulfillment.trackingCode ?? null,
                createdAt: fl.fulfillment.createdAt,
                items: [
                    {
                        orderLineId: String(fl.orderLineId),
                        ...nameByLine.get(fl.orderLineId as number)!,
                        quantity: fl.quantity,
                    },
                ],
            });
        }
        return [...grouped.values()];
    }

    /**
     * 解析指定订单中归属本店的行及其履约量。
     * 返回：myLines（line + fulfilled + remaining）、总产量、nameByLine（orderLineId→商品/变体名）。
     */
    private async resolveMyShopOrder(
        ctx: RequestContext,
        orderId: ID,
        shop: Shop,
    ): Promise<{
        myLines: Array<{ line: OrderLine; remaining: number }>;
        nameByLine: Map<number, { productName: string; variantName: string }>;
        orderHasLines: boolean;
    }> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: Number(orderId) } as any,
            relations: [
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
                'lines.productVariant.translations',
                'lines.productVariant.product.translations',
            ],
        });
        if (!order) {
            throw new EntityNotFoundError('Order', orderId);
        }
        const orderHasLines = (order.lines?.length ?? 0) > 0;
        const myLines = (order.lines ?? []).filter(l => {
            const cf = (l.productVariant?.product?.customFields ?? {}) as any;
            return Number(cf.shopId) === shop.id;
        });
        const ids = myLines.map(l => l.id as number);
        const fulfilledMap = new Map<number, number>();
        if (ids.length > 0) {
            const fls = await this.connection
                .getRepository(ctx, FulfillmentLine)
                .createQueryBuilder('fl')
                .leftJoinAndSelect('fl.fulfillment', 'fulfillment')
                .where('fl.orderLineId IN (:...ids)', { ids })
                .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
                .getMany();
            for (const fl of fls) {
                fulfilledMap.set(fl.orderLineId as number, (fulfilledMap.get(fl.orderLineId as number) ?? 0) + fl.quantity);
            }
        }
        const nameByLine = new Map<number, { productName: string; variantName: string }>();
        for (const l of myLines) {
            const pvName = this.pickName(l.productVariant?.translations, ctx.languageCode, 'name');
            const pName = this.pickName(l.productVariant?.product?.translations, ctx.languageCode, 'name');
            nameByLine.set(l.id as number, { productName: pName, variantName: pvName });
        }
        return {
            myLines: myLines.map(l => {
                const total = l.quantity;
                const fulfilled = fulfilledMap.get(l.id as number) ?? 0;
                return { line: l, remaining: total - fulfilled };
            }),
            nameByLine,
            orderHasLines,
        };
    }

    async getMyShopReviews(ctx: RequestContext): Promise<MerchantReview[]> {
        const shop = await this.requireMyShop(ctx);
        const productIds = await this.getMyShopProductIds(ctx, shop);
        if (productIds.length === 0) {
            return [];
        }
        const reviews = await this.connection.getRepository(ctx, Review).find({
            where: { productId: In(productIds), parentId: IsNull() } as any,
            order: { createdAt: 'DESC' },
        });
        const names = await this.loadProductNames(ctx, productIds);
        const result: MerchantReview[] = [];
        for (const r of reviews) {
            const customerName = await this.loadCustomerName(ctx, r.customerId);
            result.push({
                reviewId: String(r.id),
                productId: String(r.productId),
                productName: names.get(r.productId) ?? '',
                rating: r.rating,
                content: r.content,
                status: r.status,
                customerName,
                createdAt: r.createdAt,
            });
        }
        return result;
    }

    async approveMerchantReview(ctx: RequestContext, id: ID): Promise<boolean> {
        const shop = await this.requireMyShop(ctx);
        const review = await this.assertMyReview(ctx, shop, id);
        review.status = 'approved';
        await this.connection.getRepository(ctx, Review).save(review);
        if (!review.parentId) {
            await this.recomputeMerchantProductRating(ctx, review.productId);
        }
        return true;
    }

    async rejectMerchantReview(ctx: RequestContext, id: ID): Promise<boolean> {
        const shop = await this.requireMyShop(ctx);
        const review = await this.assertMyReview(ctx, shop, id);
        const wasApprovedRoot = review.status === 'approved' && !review.parentId;
        review.status = 'rejected';
        await this.connection.getRepository(ctx, Review).save(review);
        if (wasApprovedRoot) {
            await this.recomputeMerchantProductRating(ctx, review.productId);
        }
        return true;
    }

    /** 重算单个商品评分聚合（approved 主评加权，与 review-plugin 同口径）并写回 Product.customFields + 店铺评分缓存。 */
    async recomputeMerchantProductRating(ctx: RequestContext, productId: number): Promise<void> {
        const reviews = await this.connection.getRepository(ctx, Review).find({
            where: { productId, status: 'approved', parentId: IsNull() } as any,
        });
        const reviewCount = reviews.length;
        const rating =
            reviewCount === 0
                ? 0
                : Math.round((reviews.reduce((acc, r) => acc + r.rating, 0) / reviewCount) * 10) / 10;
        const product = await this.connection
            .getRepository(ctx, Product)
            .findOne({ where: { id: productId } as any });
        if (!product) {
            return;
        }
        product.customFields = {
            ...(product.customFields ?? {}),
            reviewRating: rating,
            reviewCount,
        } as any;
        await this.connection.getRepository(ctx, Product).save(product);
        const shopId = ((product.customFields ?? {}) as any).shopId ?? null;
        if (shopId != null) {
            await this.recomputeShopRating(ctx, Number(shopId));
        }
    }

    // ---------- 店主域私有助手 ----------

    private async getMyShopProductIds(ctx: RequestContext, shop: Shop): Promise<number[]> {
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { customFields: { shopId: shop.id as number } as any },
            select: ['id'],
        });
        return products.map(p => p.id as number);
    }

    private async getMyShopProductOrThrow(ctx: RequestContext, shop: Shop, productId: ID): Promise<Product> {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: Number(productId), customFields: { shopId: shop.id as number } as any },
            relations: ['translations'],
        });
        if (!product) {
            throw new ForbiddenError();
        }
        return product;
    }

    private async loadProductNames(ctx: RequestContext, productIds: number[]): Promise<Map<number, string>> {
        const map = new Map<number, string>();
        if (productIds.length === 0) {
            return map;
        }
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { id: In(productIds) as any },
            relations: ['translations'],
        });
        for (const p of products) {
            const t =
                (p.translations ?? []).find(tr => tr.languageCode === ctx.languageCode) ?? (p.translations ?? [])[0];
            map.set(p.id as number, t?.name ?? '');
        }
        return map;
    }

    private async loadCustomerName(ctx: RequestContext, customerId: number): Promise<string | null> {
        try {
            const customer = await this.connection.getEntityOrThrow(ctx, Customer, customerId);
            return [customer.firstName, customer.lastName].filter(Boolean).join(' ') || customer.emailAddress;
        } catch {
            return null;
        }
    }

    private async assertMyReview(ctx: RequestContext, shop: Shop, id: ID): Promise<Review> {
        const review = await this.connection.getEntityOrThrow(ctx, Review, id);
        const productIds = await this.getMyShopProductIds(ctx, shop);
        if (!productIds.includes(review.productId)) {
            throw new ForbiddenError();
        }
        return review;
    }

    /** 聚合我店商品行 → MerchantOrder 投影（items 仅含我店行，不泄露他人店铺行）。e2e 规模用内存聚合。 */
    private async aggregateMerchantOrders(ctx: RequestContext, shop: Shop): Promise<MerchantOrder[]> {
        const lines = await this.connection.getRepository(ctx, OrderLine).find({
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
            const cf = (l.productVariant?.product?.customFields ?? {}) as any;
            return Number(cf.shopId) === shop.id;
        });
        // 逐行已履约量（非 Cancelled FulfillmentLine 求和），供店主列表显示已发/待发。
        const fulfilledByLine = new Map<number, number>();
        if (myLines.length > 0) {
            const fls = await this.connection
                .getRepository(ctx, FulfillmentLine)
                .createQueryBuilder('fulfillmentLine')
                .leftJoinAndSelect('fulfillmentLine.fulfillment', 'fulfillment')
                .where('fulfillmentLine.orderLineId IN (:...ids)', {
                    ids: myLines.map(l => l.id as number),
                })
                .andWhere('fulfillment.state != :state', { state: 'Cancelled' })
                .getMany();
            for (const fl of fls) {
                const cur = fulfilledByLine.get(fl.orderLineId as number) ?? 0;
                fulfilledByLine.set(fl.orderLineId as number, cur + fl.quantity);
            }
        }
        const orderMap = new Map<number, MerchantOrder>();
        for (const line of myLines) {
            const order = line.order;
            if (!order) {
                continue;
            }
            const orderId = order.id as number;
            const existing = orderMap.get(orderId);
            const pv = line.productVariant;
            const product = pv?.product;
            const pvName = this.pickName(pv?.translations, ctx.languageCode, 'name');
            const pName = this.pickName(product?.translations, ctx.languageCode, 'name');
            if (existing) {
                existing.items.push({
                    orderLineId: String(line.id),
                    productId: product ? String(product.id) : '',
                    productName: pName,
                    variantName: pvName,
                    quantity: line.quantity,
                    fulfilledQuantity: fulfilledByLine.get(line.id as number) ?? 0,
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
                placedAt: order.orderPlacedAt ?? null,
                shippingAddress: order.shippingAddress
                    ? {
                          fullName: order.shippingAddress.fullName ?? null,
                          streetLine1: order.shippingAddress.streetLine1 ?? null,
                          city: order.shippingAddress.city ?? null,
                          province: order.shippingAddress.province ?? null,
                          countryCode: order.shippingAddress.countryCode ?? null,
                          postalCode: order.shippingAddress.postalCode ?? null,
                      }
                    : null,
                shippingLines: (order.shippingLines ?? []).map(sl => ({
                    id: String((sl as any).id),
                    code: sl.shippingMethod?.code ?? null,
                    name: sl.shippingMethod?.name ?? null,
                })),
                items: [
                    {
                        orderLineId: String(line.id),
                        productId: product ? String(product.id) : '',
                        productName: pName,
                        variantName: pvName,
                        quantity: line.quantity,
                        fulfilledQuantity: fulfilledByLine.get(line.id as number) ?? 0,
                        unitPriceWithTax: line.unitPriceWithTax,
                        lineTotalWithTax: line.linePriceWithTax,
                    },
                ],
            });
        }
        return [...orderMap.values()];
    }

    private pickName(
        translations: Array<{ languageCode: LanguageCode; name?: string } | undefined> | undefined,
        lang: LanguageCode,
        field: 'name',
    ): string {
        const tr = (translations ?? []).find(t => t?.languageCode === lang) ?? (translations ?? [])[0];
        return tr?.[field] ?? '';
    }

    private async assertSlugUnique(ctx: RequestContext, slug: string, excludeId?: ID): Promise<void> {
        const existing = await this.connection
            .getRepository(ctx, Shop)
            .findOne({ where: { slug } as any });
        if (existing && (!excludeId || existing.id !== Number(excludeId))) {
            throw new UserInputError(`Slug "${slug}" already in use`);
        }
    }

    private async getEntityOrThrow(ctx: RequestContext, id: ID): Promise<Shop> {
        return this.connection.getEntityOrThrow(ctx, Shop, id);
    }
}