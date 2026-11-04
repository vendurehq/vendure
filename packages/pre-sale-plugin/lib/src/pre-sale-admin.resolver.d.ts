import { ID, ListQueryOptions, PaginatedList, RequestContext } from '@vendure/core';
import { PreSaleActivity } from './pre-sale-activity.entity';
import { PreSaleService } from './pre-sale.service';
export declare class PreSaleAdminResolver {
    private preSaleService;
    constructor(preSaleService: PreSaleService);
    preSaleActivities(ctx: RequestContext, options: ListQueryOptions<PreSaleActivity>): Promise<PaginatedList<PreSaleActivity>>;
    preSaleActivity(ctx: RequestContext, id: ID): Promise<PreSaleActivity | undefined>;
    createPreSaleActivity(ctx: RequestContext, input: any): Promise<PreSaleActivity>;
    updatePreSaleActivity(ctx: RequestContext, input: any): Promise<PreSaleActivity>;
    deletePreSaleActivity(ctx: RequestContext, id: ID): Promise<boolean>;
    /**
     * 到货（active/upcoming → delivered，开启尾款窗口）本质是活动状态写操作，
     * 因此按 B2 收紧为「超管 或 本渠道 TenantPromotionManage」，不再用订单权限 UpdateOrder 代偿。
     */
    deliverPreSale(ctx: RequestContext, id: ID): Promise<PreSaleActivity>;
    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    private assertCanManage;
    /** 归属校验：非超管只能操作当前渠道的活动（channels 关联，旧数据回退 channelId 列） */
    private assertChannelAccess;
}
