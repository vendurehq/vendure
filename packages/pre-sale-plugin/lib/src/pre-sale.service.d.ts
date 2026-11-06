import { ID, Injector, ListQueryBuilder, ListQueryOptions, Order, OrderService, PaginatedList, PaymentMethodService, PaymentService, ProductVariantService, RequestContext, TransactionalConnection } from '@vendure/core';
import { PreSaleActivity } from './pre-sale-activity.entity';
export declare class PreSaleService {
    private connection;
    private listQueryBuilder;
    private orderService;
    private paymentService;
    private paymentMethodService;
    private productVariantService;
    constructor(connection: TransactionalConnection, listQueryBuilder: ListQueryBuilder, orderService: OrderService, paymentService: PaymentService, paymentMethodService: PaymentMethodService, productVariantService: ProductVariantService);
    init(injector: Injector): void;
    findAll(ctx: RequestContext, options?: ListQueryOptions<PreSaleActivity>): Promise<PaginatedList<PreSaleActivity>>;
    findOne(ctx: RequestContext, id: ID): Promise<PreSaleActivity | undefined>;
    create(ctx: RequestContext, input: Partial<PreSaleActivity>): Promise<PreSaleActivity>;
    update(ctx: RequestContext, input: any): Promise<PreSaleActivity>;
    delete(ctx: RequestContext, id: ID): Promise<void>;
    /**
     * 到货：active → delivered。
     * 到货即开启尾款窗口（deposit 模式把 tailStartAt 落到 releaseAt）。
     */
    deliverPreSale(ctx: RequestContext, id: ID): Promise<PreSaleActivity>;
    /**
     * 抢购一体：
     * 1. 取当前登录用户的 activeOrder（校验归属：order.customer.user.id === ctx.activeUserId）
     * 2. 校验活动：存在、status=active、窗口内、未售罄
     * 3. 校验订单含预售变体行；qty = 预售变体行总件数
     * 4. 限购校验：同客户该活动非取消订单累计预售件数 + qty <= limitPerUser
     * 5. 原子锁定库存（防超卖）：DB UPDATE soldCount+=qty WHERE soldCount+qty<=totalStock；失败即售罄
     * 6. 写订单 customFields（preSaleActivityId + mode + depositTotal + releaseAt 快照）+ 若 presalePrice>0 重算价格打折
     * 7. soldCount >= totalStock → 活动即时置 ended
     */
    applyPreSale(ctx: RequestContext, activityId: ID): Promise<Order>;
    /**
     * 全款预售：一次收清。
     * 新路径：期次实例存在 → paySchedulePeriod(seq=1)；否则旧路径直接收全额。
     */
    payPreSaleFull(ctx: RequestContext, orderId: ID, method: string): Promise<Order>;
    /**
     * 定金预售：付定金。
     * 新路径：期次实例存在 → paySchedulePeriod(seq=1)（内部负责 ArrangingPayment→Deposited）；
     * 旧路径：createSettledPayment + 手动转 Deposited。
     */
    payPreSaleDeposit(ctx: RequestContext, orderId: ID, method: string): Promise<Order>;
    /**
     * 定金预售：付尾款。
     * 校验状态 Deposited + 活动已到货 + 尾款窗口内（旧语义保留）。
     * 新路径：unlockTailForOrder + paySchedulePeriod（尾款期）；旧路径按剩余金额收款。
     */
    payPreSaleTail(ctx: RequestContext, orderId: ID, method: string): Promise<Order>;
    findActive(ctx: RequestContext): Promise<PreSaleActivity[]>;
    /**
     * 订单取消时按订单内预售行实际件数回滚锁定库存。
     */
    releaseStockForOrder(ctx: RequestContext, orderId: ID): Promise<void>;
    /**
     * 定金 20% 法定上限硬校验（设计 §10 合规硬点 1：超出拒绝保存）。
     * 基准价：presalePrice > 0 ? presalePrice : variant.priceWithTax（原价）。
     * 注：ProductVariant.priceWithTax 是运行时计算值（依赖 listPrice/taxRateApplied），
     * 裸 repository.findOne 不会填充（恒为 0），故经 ProductVariantService.findOne
     * 取已应用渠道价格/税的变体；变体不存在时返回 undefined（与计划的容错语义一致）。
     */
    private assertLegalDepositCap;
    /**
     * 校验订单已绑定预售活动，并返回重载后的订单（含 lines.productVariant）。
     * 同时校验订单归属：只允许订单所属客户本人支付，防止 A 用户拿 B 的 orderId 发起支付（IDOR）。
     */
    private requirePreSaleOrder;
    /** 订单归属校验：order.customer.user.id 必须等于当前登录用户 */
    private assertOrderOwner;
    /**
     * 支付方式服务端白名单：必须是当前渠道已启用的 PaymentMethod code，
     * 不存在/已停用/不属于本渠道一律拒绝（不信任前端传入的 method 字符串）。
     */
    private assertPaymentMethodAllowed;
    /**
     * 校验订单关联活动存在且处于可支付窗口（active/delivered + 窗口内）。
     */
    private requireActiveActivity;
    /**
     * 创建一笔已 Settled 的指定金额 Payment 并挂到订单。
     * 指定金额由调用方给出（定金=depositTotal，尾款=剩余，全款=totalWithTax），
     * 不走原生 addPaymentToOrder（那是一次收全额剩余，无法表达定金中间态）。
     */
    private createSettledPayment;
    /**
     * 订单状态转移（幂等失败抛出）。
     */
    private transition;
    private reload;
    /** 已 Settled 支付累计金额 */
    private settledCovered;
    /**
     * 限购校验：同客户该活动非取消订单累计预售件数 + 本次 qty <= limitPerUser。
     */
    private assertPurchaseLimit;
    /**
     * 原子锁定库存：DB UPDATE soldCount += qty
     * WHERE id = ? AND soldCount + qty <= totalStock；受影响=0 即售罄。
     */
    private reserveStock;
    /**
     * 订单取消时原子回滚锁定库存。WHERE soldCount - qty >= 0 防负数。
     * 回滚后若活动曾因售罄置 ended、仍在窗口内且未占满，恢复为 active。
     */
    private releaseStockAtomic;
    private restoreActiveIfPossible;
}
