import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    ID,
    ListQueryOptions,
    PaginatedList,
    Permission,
    RequestContext,
    Transaction,
    UserInputError,
} from '@vendure/core';

import { PreSaleActivity } from './pre-sale-activity.entity';
import { PreSaleService } from './pre-sale.service';

class PermissionError extends Error {
    constructor(code: string) {
        super(code);
        this.name = 'PermissionError';
    }
}

/** B2：租户营销活动专用写权限（在 dev-config customPermissions 中注册） */
const TENANT_PROMOTION_MANAGE = 'TenantPromotionManage' as Permission;

@Resolver()
export class PreSaleAdminResolver {
    constructor(private preSaleService: PreSaleService) {}

    /* ------------------------- 读（维持 Promotion 只读权限） ------------------------- */

    @Query()
    @Allow(Permission.ReadPromotion)
    async preSaleActivities(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<PreSaleActivity>,
    ): Promise<PaginatedList<PreSaleActivity>> {
        return this.preSaleService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    async preSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<PreSaleActivity | undefined> {
        return this.preSaleService.findOne(ctx, id);
    }

    /* ------------------------- 写（超管 或 本渠道 TenantPromotionManage） ------------------------- */

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async createPreSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<PreSaleActivity> {
        this.assertCanManage(ctx);
        // service.create 内部强制 channels=[ctx.channel] 且 channelId=ctx.channelId，不接受前端指定其它渠道
        return this.preSaleService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async updatePreSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<PreSaleActivity> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, input.id);
        return this.preSaleService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async deletePreSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<boolean> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        await this.preSaleService.delete(ctx, id);
        return true;
    }

    /**
     * 到货（active/upcoming → delivered，开启尾款窗口）本质是活动状态写操作，
     * 因此按 B2 收紧为「超管 或 本渠道 TenantPromotionManage」，不再用订单权限 UpdateOrder 代偿。
     */
    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async deliverPreSale(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<PreSaleActivity> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        return this.preSaleService.deliverPreSale(ctx, id);
    }

    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    private assertCanManage(ctx: RequestContext): void {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return;
        if (!ctx.userHasPermissions([TENANT_PROMOTION_MANAGE])) {
            throw new PermissionError('PROMOTION_FORBIDDEN');
        }
    }

    /** 归属校验：非超管只能操作当前渠道的活动（channels 关联，旧数据回退 channelId 列） */
    private async assertChannelAccess(ctx: RequestContext, id: ID): Promise<void> {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return;
        const activity = await this.preSaleService.findOne(ctx, id);
        if (!activity) {
            throw new UserInputError(`PreSaleActivity with id ${id} not found`);
        }
        const channels = ((activity as any).channels ?? []) as any[];
        const byChannels = channels.some(c => String(c.id) === String(ctx.channelId));
        const byColumn = String((activity as any).channelId) === String(ctx.channelId);
        if (!byChannels && !byColumn) {
            throw new PermissionError('PROMOTION_CHANNEL_FORBIDDEN');
        }
    }
}
