import { ID, ListQueryOptions, PaginatedList, RequestContext } from '@vendure/core';
import { FlashSaleActivity } from './flash-sale-activity.entity';
import { FlashSaleService } from './flash-sale.service';
export declare class FlashSaleAdminResolver {
    private flashSaleService;
    constructor(flashSaleService: FlashSaleService);
    flashSaleActivities(ctx: RequestContext, options: ListQueryOptions<FlashSaleActivity>): Promise<PaginatedList<FlashSaleActivity>>;
    flashSaleActivity(ctx: RequestContext, id: ID): Promise<FlashSaleActivity | undefined>;
    createFlashSaleActivity(ctx: RequestContext, input: any): Promise<FlashSaleActivity>;
    updateFlashSaleActivity(ctx: RequestContext, input: any): Promise<FlashSaleActivity>;
    /** 显式改状态（结束/启用/恢复未开始）：替代 Update input 中已移除的 status 字段 */
    setFlashSaleActivityStatus(ctx: RequestContext, id: ID, status: 'upcoming' | 'active' | 'ended'): Promise<FlashSaleActivity>;
    deleteFlashSaleActivity(ctx: RequestContext, id: ID): Promise<boolean>;
    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    private assertCanManage;
    /** 归属校验：非超管只能操作当前渠道的活动（防跨渠道 IDOR） */
    private assertChannelAccess;
}
