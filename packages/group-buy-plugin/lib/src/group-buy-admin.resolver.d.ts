import { ID, ListQueryOptions, PaginatedList, RequestContext } from '@vendure/core';
import { GroupBuyActivity } from './group-buy-activity.entity';
import { GroupBuyService } from './group-buy.service';
export declare class GroupBuyAdminResolver {
    private groupBuyService;
    constructor(groupBuyService: GroupBuyService);
    groupBuyActivities(ctx: RequestContext, options: ListQueryOptions<GroupBuyActivity>): Promise<PaginatedList<GroupBuyActivity>>;
    groupBuyActivity(ctx: RequestContext, id: ID): Promise<GroupBuyActivity | undefined>;
    createGroupBuyActivity(ctx: RequestContext, input: any): Promise<GroupBuyActivity>;
    updateGroupBuyActivity(ctx: RequestContext, input: any): Promise<GroupBuyActivity>;
    deleteGroupBuyActivity(ctx: RequestContext, id: ID): Promise<boolean>;
    /**
     * 过期检查为批量运维操作：service 内部已按 ctx.channelId 过滤活动（只处理本渠道），
     * 因此这里只做写权限门控，不再逐条做归属校验。
     */
    runGroupBuyExpiryCheck(ctx: RequestContext): Promise<boolean>;
    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    private assertCanManage;
    /** 归属校验：非超管只能操作当前渠道的活动（防跨渠道 IDOR） */
    private assertChannelAccess;
}
