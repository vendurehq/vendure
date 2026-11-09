import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    Allow,
    Ctx,
    CustomerService,
    EntityNotFoundError,
    ForbiddenError,
    ID,
    isGraphQlErrorResult,
    ListQueryBuilder,
    Logger,
    Order,
    OrderService,
    PaginatedList,
    Payment,
    PaymentService,
    Permission,
    Refund,
    Relations as GraphQLRelations,
    RequestContext,
    StockMovementService,
    Transaction,
    TransactionalConnection,
    UnauthorizedError,
    UserInputError,
} from '@vendure/core';
import { getCodRefundPolicyPort } from '../payment/cod-refund-port';

const loggerCtx = 'MyOrdersShopResolver';

/** 顾客可自行取消的订单状态（尚未支付/未进入履约） */
const CUSTOMER_CANCELLABLE_STATES = ['Created', 'AddingItems', 'ArrangingPayment'];
/** 已下单未支付（支付已授权未结算）也允许顾客自助取消 */
const UNPAID_AUTHORIZED_STATE = 'PaymentAuthorized';
/**
 * 已实付外卖单自助取消窗口：hallStatus 必须仍是「未开始履约」的态——
 * 空（未入厅/入厅失败）、scheduled（预约未到点）、pending_merchant（等商家接单）、open（等骑手接单）。
 * 一旦商家接单/出餐、骑手抢单、推送外部快递或送达，都不再允许顾客自助取消。
 */
const PAID_CANCELLABLE_HALL_STATUSES = ['', 'scheduled', 'pending_merchant', 'open'];
/** 走骑手履约的校园路线（R4 到店自取不在本窗口内；普通快递单不走本分支） */
const CAMPUS_RIDER_ROUTES = ['R1', 'R2', 'R3', 'R5'];
/** 已产生的配送动作：出现即禁止自助取消 */
const ASSIGNED_DELIVERY_STATUSES = ['assigned', 'in_progress', 'delivered'];
/** 可退款支付状态（与 campus 退款口径一致） */
const REFUNDABLE_PAYMENT_STATES = ['Settled', 'Authorized'];
/** 已实付状态 */
const PAID_SETTLED_STATE = 'PaymentSettled';

/**
 * C 端「我的订单」列表查询。
 *
 * 前端 `vshop/src/api/queries/order.ts#getOrders` 一直在发
 * `myOrders(options: OrderListOptions): OrderList!`，但生产 shop-api 上从未注册过该字段，
 * 导致「我的订单」页恒空。此处补齐字段并用当前登录用户反查 customer，严格按顾客隔离，
 * 拿不到顾客即返回空列表（绝不返回全站订单，防串号）。
 *
 * 排除 Draft（草稿单）与 AddingItems（顾客正在编辑的购物车单），
 * 保留 ArrangingPayment 及之后所有已下单状态。
 *
 * 关系不用手写列表，而是走 core 的 `@Relations(Order)` 装饰器：它按本次 GraphQL 查询的
 * 选择集推导所需关系，并带上 `@Calculated()` 属性（taxSummary / discounts / totalQuantity）
 * 声明的关系依赖。手写列表一旦漏项（如漏 `surcharges`）就会整条查询报
 * 「property "taxSummary" ... requires the Order.surcharges relation to be joined」，
 * 前端只会表现为「暂无订单」，难以定位。
 */
@Resolver()
export class MyOrdersShopResolver {
    constructor(
        private customerService: CustomerService,
        private listQueryBuilder: ListQueryBuilder,
        private orderService: OrderService,
        private stockMovementService: StockMovementService,
        private paymentService: PaymentService,
        private connection: TransactionalConnection,
    ) {}

    @Query()
    @Allow(Permission.Authenticated)
    async myOrders(
        @Ctx() ctx: RequestContext,
        @Args('options', { nullable: true }) options: any,
        @GraphQLRelations(Order) relations: string[],
    ): Promise<PaginatedList<Order>> {
        if (!ctx.activeUserId) {
            return { items: [], totalItems: 0 };
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            return { items: [], totalItems: 0 };
        }
        const effectiveOptions = options ?? { take: 10, sort: { createdAt: 'DESC' } };
        return this.listQueryBuilder
            .build(Order, effectiveOptions, { ctx, channelId: ctx.channelId, relations })
            .andWhere('order.customer.id = :customerId', { customerId: customer.id })
            .andWhere('order.state NOT IN (:...excludedStates)', {
                excludedStates: ['Draft', 'AddingItems'],
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /**
     * C 端「取消订单」：
     * - 未支付/未履约（Created/AddingItems/ArrangingPayment）：释放库存分配后整体取消；
     *   core 的 cancelOrder 对 active 订单（如 ArrangingPayment）不会释放库存分配，
     *   需先显式释放，否则取消后库存被永久占用（与 order-timeout-plugin 同一处理）。
     * - 已下单未支付（PaymentAuthorized）：先逐笔取消未结算支付（Authorized → Cancelled），
     *   再整体取消订单（已下单单走 cancelOrderByOrderLines，幂等释放分配）。
     *   守卫：任一支付已结算（Settled）→ 拒绝（实付单走售后退款）；含酒店行 → 拒绝
     *   （走 OrderHotelCancelModal 专用取消/退款流程，避免预订单悬空）。
     * - 已实付外卖单（PaymentSettled）：仅「未开始履约」窗口（hallStatus=空/scheduled/pending_merchant/open，
     *   且无骑手/无外部运单/未送达）允许自助取消；全额退款后取消订单，由取消事件自动脱厅/释放时段锁。
     *   已接单、已出餐、已抢单、已推送外部快递、已送达一律拒绝（提示走售后）。
     */
    @Transaction()
    @Mutation()
    @Allow(Permission.Authenticated)
    async cancelMyOrder(@Ctx() ctx: RequestContext, @Args('orderId') orderId: ID): Promise<Order> {
        if (!ctx.activeUserId) {
            throw new UnauthorizedError();
        }
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user', 'lines']);
        if (!order) {
            throw new EntityNotFoundError('Order', orderId);
        }
        // 归属校验：order.customer.id 是 Customer 主键，与 activeUserId（User 主键）不同，须比 customer.user.id
        const customerUserId = (order.customer as any)?.user?.id;
        if (!order.customer || customerUserId == null || String(customerUserId) !== String(ctx.activeUserId)) {
            throw new ForbiddenError();
        }
        if (order.state === PAID_SETTLED_STATE) {
            return this.cancelPaidOrder(ctx, order);
        }
        if (!CUSTOMER_CANCELLABLE_STATES.includes(order.state) && order.state !== UNPAID_AUTHORIZED_STATE) {
            throw new UserInputError(`ORDER_CANNOT_BE_CANCELLED:${order.state}`);
        }
        if (order.state === UNPAID_AUTHORIZED_STATE) {
            // 含酒店行的已下单单走酒店专用取消/退款（预订单锁房/截止点独立收口），不开放自助取消
            const hasHotelLine = (order.lines ?? []).some(l => {
                const cf = (l as any).customFields;
                return !!cf?.hotelCheckIn && !!cf?.hotelCheckOut;
            });
            if (hasHotelLine) {
                throw new UserInputError(`ORDER_CANNOT_BE_CANCELLED:${order.state}`);
            }
            const payments = await this.connection
                .getRepository(ctx, Payment)
                .find({ where: { order: { id: order.id } } });
            // 全部支付须处于 Authorized（或历史已 Cancelled 的重试幂等）；Settled 实付/Declined/Error 异常态拒绝
            if (payments.length === 0 || payments.some(p => p.state !== 'Authorized' && p.state !== 'Cancelled')) {
                throw new UserInputError(`ORDER_CANNOT_BE_CANCELLED:${order.state}`);
            }
            for (const payment of payments) {
                if (payment.state === 'Cancelled') {
                    continue;
                }
                const cancelled = await this.paymentService.cancelPayment(ctx, payment.id);
                if (isGraphQlErrorResult(cancelled) || cancelled.state !== 'Cancelled') {
                    Logger.warn(`取消订单支付失败 order#${orderId} payment#${payment.id}`, loggerCtx);
                    throw new UserInputError('PAYMENT_CANCEL_FAILED');
                }
            }
            const unpaidResult = await this.orderService.cancelOrder(ctx, { orderId });
            if (isGraphQlErrorResult(unpaidResult)) {
                Logger.warn(`取消订单失败 order#${orderId}: ${unpaidResult.message}`, loggerCtx);
                throw new UserInputError(unpaidResult.message);
            }
            return unpaidResult;
        }
        const lines = (order.lines ?? []).map(l => ({ orderLineId: l.id, quantity: l.quantity }));
        if (lines.length > 0) {
            await this.stockMovementService.createReleasesForOrderLines(ctx, lines);
        }
        const result = await this.orderService.cancelOrder(ctx, { orderId });
        if (isGraphQlErrorResult(result)) {
            Logger.warn(`取消订单失败 order#${orderId}: ${result.message}`, loggerCtx);
            throw new UserInputError(result.message);
        }
        return result;
    }

    /**
     * 已实付外卖单自助取消：退款 + 取消。
     * 用订单级 PG 咨询锁串行化，避免与商家拒单 / T4 无人接单退款 / 调度超时兜底并发时重复退款。
     * 退款口径与 campus 一致：只退 Settled/Authorized 且仍有余额的支付单（排除 Failed 退款单）。
     * 取消后由 campus 插件的 Cancelled 事件自动脱厅、取消外部运单、释放时段锁位。
     */
    private async cancelPaidOrder(ctx: RequestContext, order: Order): Promise<Order> {
        const cf = (order.customFields ?? {}) as any;
        const route = String(cf.fulfillmentRoute ?? '');
        // 仅校园骑手履约单；R4 到店自取/普通快递不在此窗口（到店自取可能已核销，盲退有资损风险）
        if (cf.orderKind !== 'errand' && !CAMPUS_RIDER_ROUTES.includes(route)) {
            throw new UserInputError(`ORDER_CANNOT_BE_CANCELLED:${order.state}`);
        }
        this.assertPaidCancelable(cf);

        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:refund:${order.id}`;
        try {
            const got: any = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!rows?.[0]?.ok) {
                throw new UserInputError('该订单正在处理中，请稍后重试');
            }
            // 锁内复查：等待锁期间可能已被商家接单/骑手抢单/T4 退款
            const fresh = await this.orderService.findOne(ctx, order.id, ['lines']);
            if (!fresh || fresh.state !== PAID_SETTLED_STATE) {
                throw new UserInputError(`ORDER_CANNOT_BE_CANCELLED:${fresh?.state ?? 'UNKNOWN'}`);
            }
            this.assertPaidCancelable((fresh.customFields ?? {}) as any);

            await this.refundAllPaid(ctx, fresh);
            const cancelled = await this.orderService.cancelOrder(ctx, {
                orderId: fresh.id,
                reason: '顾客取消（已支付未接单）',
            } as any);
            if (isGraphQlErrorResult(cancelled)) {
                Logger.warn(`实付单取消失败 order#${order.id}: ${cancelled.message}`, loggerCtx);
                throw new UserInputError(cancelled.message);
            }
            return cancelled;
        } finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            } catch {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }

    /** 校验「已支付且尚未开始履约」：任何履约动作出现即拒绝自助取消 */
    private assertPaidCancelable(cf: any): void {
        const hallStatus = String(cf.hallStatus ?? '');
        if (!PAID_CANCELLABLE_HALL_STATUSES.includes(hallStatus)) {
            throw new UserInputError(`ORDER_ALREADY_IN_FULFILLMENT:${hallStatus}`);
        }
        const deliveryStatus = String(cf.deliveryStatus ?? '');
        if (cf.deliveryStaffId != null || ASSIGNED_DELIVERY_STATUSES.includes(deliveryStatus)) {
            throw new UserInputError('ORDER_ALREADY_ASSIGNED');
        }
        // 外部快递已推送/已接单（含回调异常态）同样不可自助取消
        if (cf.thirdPartyState || cf.thirdPartyOrderId) {
            throw new UserInputError('ORDER_ALREADY_ASSIGNED');
        }
    }

    /** 全额退款：逐笔退剩余额度；refundOrder 停在 Pending 时推进到 Settled，未达 Settled 视为失败 */
    private async refundAllPaid(ctx: RequestContext, order: Order): Promise<void> {
        const payments = await this.connection
            .getRepository(ctx, Payment)
            .find({ where: { order: { id: order.id } }, order: { id: 'DESC' } } as any);
        for (const payment of payments) {
            if (!REFUNDABLE_PAYMENT_STATES.includes(String(payment.state))) continue;
            const refunded = await this.connection
                .getRepository(ctx, Refund)
                .createQueryBuilder('r')
                .select('COALESCE(SUM(r.total), 0)', 'sum')
                .where('r.paymentId = :pid', { pid: payment.id })
                .andWhere('r.state <> :failed', { failed: 'Failed' })
                .getRawOne();
            const remaining = Number(payment.amount) - Number(refunded?.sum ?? 0);
            if (remaining <= 0) continue;
            if (String(payment.method) === 'cash-on-delivery') {
                // COD：只认 confirmed 收款；有收款则建单即 Settled（现金已退），无收款不建单
                const policy = getCodRefundPolicyPort();
                if (!policy) {
                    throw new UserInputError('REFUND_FAILED:NO_COD_GATE');
                }
                const result: any = await policy.createRefund(ctx, {
                    orderId: order.id,
                    paymentId: payment.id,
                    amount: remaining,
                    reason: `customer cancel (${order.code})`,
                });
                if (result instanceof Error || result?.errorCode) {
                    throw new UserInputError(
                        `REFUND_FAILED:${result?.message ?? result?.errorCode ?? 'COD_GATE'}`,
                    );
                }
                if (String(result?.state) !== 'Settled') {
                    throw new UserInputError(`REFUND_FAILED:${result?.state ?? 'UNKNOWN'}`);
                }
                continue;
            }
            let refund: any = await this.orderService.refundOrder(ctx, {
                paymentId: payment.id,
                amount: remaining,
                // refund 表 shipping/adjustment 列 NOT NULL，显式给 0（与 campus 同口径）
                shipping: 0,
                adjustment: 0,
                reason: `customer cancel (${order.code})`,
            } as any);
            if (!refund || refund.errorCode) {
                Logger.warn(`实付单退款失败 order#${order.id}: ${refund?.errorCode ?? 'unknown'}`, loggerCtx);
                throw new UserInputError(`REFUND_FAILED:${refund?.errorCode ?? 'UNKNOWN'}`);
            }
            if (refund.state === 'Pending') {
                refund = await this.orderService.settleRefund(ctx, {
                    id: refund.id,
                    transactionId: refund.transactionId ?? refund.paymentId ?? '',
                } as any);
            }
            if (refund?.state !== 'Settled') {
                Logger.warn(`实付单退款未达 Settled order#${order.id}: ${refund?.state}`, loggerCtx);
                throw new UserInputError(`REFUND_FAILED:${refund?.state ?? 'UNKNOWN'}`);
            }
        }
    }
}
