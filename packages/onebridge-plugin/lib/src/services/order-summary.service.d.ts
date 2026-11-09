import { CustomerService, OrderService, RequestContext, TransactionalConnection } from '@vendure/core';
import { StageEvent } from '../entities';
/** 订单聚合（CT-04）：标准 Order 字段 + 跨境 customFields + StageEvent 时间轴。 */
export declare class OnebridgeOrderSummaryService {
    private connection;
    private orderService;
    private customerService;
    constructor(connection: TransactionalConnection, orderService: OrderService, customerService: CustomerService);
    summary(ctx: RequestContext, orderCode: string, enforceOwnership: boolean): Promise<any>;
    timeline(ctx: RequestContext, orderCode: string): Promise<StageEvent[]>;
    /**
     * 物流轨迹（CT-09 orderTracks）：承运商单号/状态读 logistics-plugin 的 logistics_track；
     * 承运商轨迹接入前，trackInfo 复用 CT-10 业务时间轴，避免前端出现空轨道。
     * TODO(联调)：logistics_track.trackInfo 的承运商节点映射与 carrierName 字典待物流插件提供。
     */
    orderTracks(ctx: RequestContext, orderCode: string, enforceOwnership?: boolean): Promise<any>;
    /** 读取最近一条物流轨迹；logistics-plugin 未安装/未建表时返回 null（不阻断联调） */
    private latestLogisticsTrack;
    private assertOwnership;
}
