import { Injectable } from '@nestjs/common';
import {
    assertFound,
    ChannelService,
    Collection,
    CollectionService,
    ForbiddenError,
    ID,
    idsAreEqual,
    InternalServerError,
    Permission,
    Product,
    RequestContext,
    TransactionalConnection,
    Translated,
    UserInputError,
} from '@vendure/core';
import { CreateCollectionInput } from '@vendure/common/lib/generated-types';

@Injectable()
export class TenantCatalogService {
    constructor(
        private collectionService: CollectionService,
        private channelService: ChannelService,
        private connection: TransactionalConnection,
    ) {}

    /** 是否平台超管（沿用 my-access 的口径：session.user.superAdmin 或任一渠道角色含 SuperAdmin） */
    private isSuperAdmin(ctx: RequestContext): boolean {
        const user: any = (ctx as any).session?.user;
        if (user?.superAdmin === true) return true;
        const perms: any[] = user?.channelPermissions || [];
        return perms.some((cp: any) => (cp.permissions || []).includes(Permission.SuperAdmin));
    }

    /** 目标渠道必须属于操作者的 channelPermissions（或超管），防止跨租户操作他人渠道 */
    private assertChannelAccess(ctx: RequestContext, channelId: ID): void {
        if (this.isSuperAdmin(ctx)) return;
        const perms: any[] = ((ctx as any).session?.user?.channelPermissions || []);
        const allowed = perms.some((c: any) => String(c.id) === String(channelId));
        if (!allowed) {
            // 目标渠道不在操作者 channelPermissions 内
            throw new ForbiddenError();
        }
    }

    /** 商品必须属于当前请求渠道，防止 A 店改 B 店商品 */
    private async assertProductInChannel(ctx: RequestContext, productId: ID): Promise<Product> {
        const product = await this.connection
            .getRepository(ctx, Product)
            .findOne({ where: { id: String(productId) } as any, relations: ['channels'] });
        if (!product) {
            throw new UserInputError(`商品 ${productId} 不存在`);
        }
        const belongs = (product.channels || []).some(
            (c: any) => String(c.id) === String(ctx.channelId),
        );
        if (!belongs) {
            // 商品不属于当前渠道
            throw new ForbiddenError();
        }
        return product;
    }

    /**
     * 分类归属校验：超管放行；否则分类须挂当前渠道（租户自有分类）
     * 或挂默认渠道（平台公共分类，租户归位时允许追加商品）。
     */
    private async assertCollectionAccess(ctx: RequestContext, collection: Collection): Promise<void> {
        if (this.isSuperAdmin(ctx)) return;
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const channelIds = new Set<string>([
            String(ctx.channelId),
            String(defaultChannel.id),
        ]);
        const belongs = ((collection as any).channels || []).some((c: any) =>
            channelIds.has(String(c.id)),
        );
        if (!belongs) {
            // 分类既不属于当前渠道，也不是默认渠道的平台分类
            throw new ForbiddenError();
        }
    }

    /** 解析 productIds 参数值：Vendure ConfigArg 中 list 型参数以 JSON 字符串存储（如 '[60]' / '["60"]'），兼容数组。 */
    private parseIdList(value: unknown): ID[] {
        if (Array.isArray(value)) return value.map(String);
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.map(String) : [];
            } catch {
                return value ? [value] : [];
            }
        }
        return [];
    }

    /**
     * 创建租户分类后，主动从默认渠道摘除，实现「租户分类只挂租户渠道、进默认商城」双轨隔离。
     * 不能走 removeCollectionsFromChannel（会对默认渠道抛错），须直接 channelService.removeFromChannels。
     */
    async createTenantCollection(
        ctx: RequestContext,
        input: CreateCollectionInput,
    ): Promise<Translated<Collection>> {
        const collection = await this.collectionService.create(ctx, input);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!idsAreEqual(defaultChannel.id, ctx.channelId)) {
            await this.channelService.removeFromChannels(ctx, Collection, collection.id, [
                defaultChannel.id,
            ]);
        }
        return assertFound(this.collectionService.findOne(ctx, collection.id));
    }

    /** 把商品 ID 追加进平台分类的 productId 过滤器（只增；非 productId 独过滤器则新建一条 productId 过滤器，不改其它过滤器）。 */
    async addProductToCollection(ctx: RequestContext, productId: ID, collectionId: ID): Promise<void> {
        // 归属校验：商品必须属于当前渠道；分类须为当前渠道或默认渠道（平台分类）
        await this.assertProductInChannel(ctx, productId);
        const repo = this.connection.getRepository(ctx, Collection);
        const collection = await repo.findOne({
            where: { id: String(collectionId) },
            relations: ['channels'],
        } as any);
        if (!collection) return;
        await this.assertCollectionAccess(ctx, collection);
        // Vendure ConfigurableOperation 标准形态：{ code, args: [{name, value}] }，list 参数值存 JSON 字符串。
        const filters: Array<{ code: string; args: Array<{ name: string; value: unknown }> }> =
            collection.filters ?? [];
        const productIdFilter = filters.find(f => f.code === 'product-id-filter');
        if (productIdFilter) {
            const idsArg = productIdFilter.args?.find(a => a.name === 'productIds');
            const existing = this.parseIdList(idsArg?.value);
            if (!existing.includes(String(productId))) {
                const newValue = JSON.stringify([...existing, String(productId)]);
                if (idsArg) {
                    idsArg.value = newValue;
                } else {
                    (productIdFilter.args = productIdFilter.args ?? []).push({
                        name: 'productIds',
                        value: newValue,
                    });
                }
            }
        } else {
            filters.push({
                code: 'product-id-filter',
                args: [
                    { name: 'productIds', value: JSON.stringify([String(productId)]) },
                    { name: 'combineWithAnd', value: 'false' },
                ],
            });
        }
        // 用 repo.update 显式只更新 filters 列（无条件发 UPDATE，绕开 TypeORM save() 对 simple-json 的引用级脏检测，确保真正持久化）。
        await repo.update(collection.id, { filters } as any);
        // 重新计算该分类的变体成员，使商品立即出现在分类列表页（等价 updateCollection 的 applyCollectionFilters）。
        await this.collectionService.triggerApplyFiltersJob(ctx, {
            collectionIds: [collection.id],
        });
    }

    /**
     * 把商品挂到租户渠道并从默认渠道摘除（双轨隔离）。
     * 不能走 removeProductsFromChannel（会被「默认渠道不可摘除」守卫拦），须直接 channelService.removeFromChannels。
     */
    async moveProductsToTenantChannel(
        ctx: RequestContext,
        productIds: ID[],
        channelId: ID,
    ): Promise<Product[]> {
        // 目标渠道必须在操作者权限范围内（或超管）
        this.assertChannelAccess(ctx, channelId);
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const channel = await this.channelService.findOne(ctx, channelId);
        if (!channel) throw new InternalServerError(`Channel not found: ${channelId}`);
        const result: Product[] = [];
        for (const id of productIds) {
            // 商品必须属于当前渠道，防止把别店商品挂进本店 / 从默认渠道摘除
            await this.assertProductInChannel(ctx, id);
            if (!idsAreEqual(channel.id, defaultChannel.id)) {
                await this.channelService.assignToChannels(ctx, Product, id, [channel.id]);
            }
            await this.channelService.removeFromChannels(ctx, Product, id, [defaultChannel.id]);
            const p = await this.connection
                .getRepository(ctx, Product)
                .findOne({ where: { id: String(id) } } as any);
            if (p) result.push(p);
        }
        return result;
    }
}