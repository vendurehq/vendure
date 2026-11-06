import { ID, Injector, ListQueryBuilder, ListQueryOptions, Order, OrderService, PaginatedList, RequestContext, TransactionalConnection } from '@vendure/core';
import { FlashSaleActivity } from './flash-sale-activity.entity';
export declare class FlashSaleService {
    private connection;
    private listQueryBuilder;
    private orderService;
    constructor(connection: TransactionalConnection, listQueryBuilder: ListQueryBuilder, orderService: OrderService);
    private stockReserveService;
    init(injector: Injector): void;
    findAll(ctx: RequestContext, options?: ListQueryOptions<FlashSaleActivity>): Promise<PaginatedList<FlashSaleActivity>>;
    findOne(ctx: RequestContext, id: ID): Promise<FlashSaleActivity | undefined>;
    create(ctx: RequestContext, input: Partial<FlashSaleActivity>): Promise<FlashSaleActivity>;
    update(ctx: RequestContext, input: any): Promise<FlashSaleActivity>;
    /**
     * 显式改状态（替代 Update input 中已被静默忽略的 status 字段）。
     * 规则：ended 随时可设（人工下线）；active 必须在 [startAt, endAt] 内；
     * upcoming 只能在开始前恢复。每次变更写结构化日志（操作人/渠道/前后状态）。
     */
    setStatus(ctx: RequestContext, id: ID, status: 'upcoming' | 'active' | 'ended'): Promise<FlashSaleActivity>;
    delete(ctx: RequestContext, id: ID): Promise<void>;
    /**
     * 抢购一体：
     * 1. 取当前登录用户的 activeOrder（校验归属：order.customer.user.id === ctx.activeUserId）
     * 2. 校验活动：存在、status=active、窗口内
     * 3. 校验订单含秒杀变体行；qty = 秒杀变体行总件数
     * 4. 限购校验：同客户该活动非取消订单累计秒杀件数 + qty <= limitPerUser
     * 5. 原子占用库存（防超卖）：DB UPDATE soldCount+=qty WHERE soldCount+qty<=totalStock；失败即售罄
     * 6. 写订单 customFields（flashSaleActivityId + startAt/endAt 快照）并重算价格 → 秒杀价立即生效
     * 7. soldCount >= totalStock → 活动即时置 ended
     */
    applyFlashSale(ctx: RequestContext, activityId: ID): Promise<Order>;
    findActive(ctx: RequestContext): Promise<FlashSaleActivity[]>;
    findActiveByVariant(ctx: RequestContext, variantId: ID): Promise<FlashSaleActivity | undefined>;
    /**
     * 订单取消时回滚占用库存：Redis 路径走 StockReserveService，DB 路径走原子 UPDATE。
     * quantity 为订单内秒杀变体行总件数（修正原先固定 1 件）。
     */
    releaseStock(ctx: RequestContext, activityId: ID, quantity: number): Promise<void>;
    /**
     * 订单取消时按订单内秒杀行实际件数回滚预占库存。
     * 由 plugin 的 OrderStateTransitionEvent 处理器调用（替代原先固定 1 件）。
     */
    releaseStockForOrder(ctx: RequestContext, orderId: ID): Promise<void>;
    /**
     * 限购校验：同客户该活动非取消订单累计秒杀件数 + 本次 qty <= limitPerUser。
     */
    private assertPurchaseLimit;
    /**
     * 原子占用库存：DB 路径 UPDATE ... SET soldCount += qty
     * WHERE id = ? AND soldCount + qty <= totalStock；受影响=0 即售罄。
     */
    private reserveStock;
    /**
     * DB fallback 原子回滚：订单取消时回滚预占库存。
     * 使用 WHERE soldCount - quantity >= 0 防止负数。
     * 回滚后若活动曾因售罄置 ended、仍在时间窗口内且未占满，恢复为 active。
     */
    private releaseStockAtomic;
    /**
     * Redis 路径回滚后同样恢复状态（与 DB 路径语义一致）。
     */
    private restoreActiveIfPossible;
}
