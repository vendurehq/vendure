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

import { GroupBuyActivity } from './group-buy-activity.entity';
import { GroupBuyService } from './group-buy.service';

class PermissionError extends Error {
    constructor(code: string) {
        super(code);
        this.name = 'PermissionError';
    }
}

/** B2：租户营销活动专用写权限（在 dev-config customPermissions 中注册） */
const TENANT_PROMOTION_MANAGE = 'TenantPromotionManage' as Permission;

@Resolver()
export class GroupBuyAdminResolver {
    constructor(private groupBuyService: GroupBuyService) {}

    /* ------------------------- 读（维持 Promotion 只读权限） ------------------------- */

    @Query()
    @Allow(Permission.ReadPromotion)
    async groupBuyActivities(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: ListQueryOptions<GroupBuyActivity>,
    ): Promise<PaginatedList<GroupBuyActivity>> {
        return this.groupBuyService.findAll(ctx, options);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    async groupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<GroupBuyActivity | undefined> {
        return this.groupBuyService.findOne(ctx, id);
    }

    /* ------------------------- 写（超管 或 本渠道 TenantPromotionManage） ------------------------- */

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async createGroupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<GroupBuyActivity> {
        this.assertCanManage(ctx);
        // service.create 内部强制 channels=[ctx.channel]，不接受前端指定其它渠道
        return this.groupBuyService.create(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async updateGroupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('input') input: any,
    ): Promise<GroupBuyActivity> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, input.id);
        return this.groupBuyService.update(ctx, input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async deleteGroupBuyActivity(
        @Ctx() ctx: RequestContext,
        @Args('id') id: ID,
    ): Promise<boolean> {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        await this.groupBuyService.delete(ctx, id);
        return true;
    }

    /**
     * 过期检查为批量运维操作：service 内部已按 ctx.channelId 过滤活动（只处理本渠道），
     * 因此这里只做写权限门控，不再逐条做归属校验。
     */
    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async runGroupBuyExpiryCheck(@Ctx() ctx: RequestContext): Promise<boolean> {
        this.assertCanManage(ctx);
        await this.groupBuyService.processExpired(ctx);
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
        const activity = await this.groupBuyService.findOne(ctx, id);
        if (!activity) {
            throw new UserInputError(`GroupBuyActivity with id ${id} not found`);
        }
        const channels = ((activity as any).channels ?? []) as any[];
        if (!channels.some(c => String(c.id) === String(ctx.channelId))) {
            throw new PermissionError('PROMOTION_CHANNEL_FORBIDDEN');
        }
    }
}
