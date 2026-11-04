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

import { FlashSaleActivity } from './flash-sale-activity.entity';
import { FlashSaleService } from './flash-sale.service';

class PermissionError extends Error {
    constructor(code: string) {
        super(code);
        this.name = 'PermissionError';
    }
}

/** B2：租户营销活动专用写权限（在 dev-config customPermissions 中注册） */
const TENANT_PROMOTION_MANAGE = 'TenantPromotionManage' as Permission;

@Resolver()
export class FlashSaleAdminResolver {
    constructor(private flashSaleService: FlashSaleService) {}

    /* ------------------------- 读（维持 Promotion 只读权限） ------------------------- */

    @Query()
    @Allow(Permission.ReadPromotion)
    async flashSaleActivities(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<FlashSaleActivity>,
    ): Promise<PaginatedList<FlashSaleActivity>> {
        return this.flashSaleService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    async flashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<FlashSaleActivity | undefined> {
        return this.flashSaleService.findOne(ctx, id);
    }

    /* ------------------------- 写（超管 或 本渠道 TenantPromotionManage） ------------------------- */

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async createFlashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<FlashSaleActivity> {
        this.assertCanManage(ctx);
        // service.create 内部强制 channels=[ctx.channel]，不接受前端指定其它渠道
        return this.flashSaleService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async updateFlashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<FlashSaleActivity> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, input.id);
        return this.flashSaleService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async deleteFlashSaleActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<boolean> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        await this.flashSaleService.delete(ctx, id);
        return true;
    }

    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    private assertCanManage(ctx: RequestContext): void {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return;
        if (!ctx.userHasPermissions([TENANT_PROMOTION_MANAGE])) {
            throw new PermissionError('PROMOTION_FORBIDDEN');
        }
    }

    /** 归属校验：非超管只能操作当前渠道的活动（防跨渠道 IDOR） */
    private async assertChannelAccess(ctx: RequestContext, id: ID): Promise<void> {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return;
        const activity = await this.flashSaleService.findOne(ctx, id);
        if (!activity) {
            throw new UserInputError(`FlashSaleActivity with id ${id} not found`);
        }
        const channels = ((activity as any).channels ?? []) as any[];
        if (!channels.some(c => String(c.id) === String(ctx.channelId))) {
            throw new PermissionError('PROMOTION_CHANNEL_FORBIDDEN');
        }
    }
}
