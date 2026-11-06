import { ID, OrderService, Payment, PaymentService, RequestContext, TransactionalConnection } from '@vendure/core';
import { Connection } from 'typeorm';
import { PosSession } from '../entities/pos-session.entity';
import { SettleSessionAggregatePaysResult } from '../types';
import { PosOrderService } from './pos-order.service';
/**
 * 聚合码支付服务：
 * - createPendingPayment: 创建 Payment(state=Created) + Order → ArrangingPayment
 * - confirmPayment: Payment Created → Authorized（客户已扫码付款）
 * - settlePayment: Payment Authorized → Settled（关班时批量结算）
 * - failPayment: Payment Created → Cancelled（超时）
 *
 * 关键实现细节（Vendure 3.6.4）：
 * 1. PaymentService.transitionToState 对 'Authorized' 不走 handler，可直接调用
 * 2. PaymentService.transitionToState 对 'Settled' 会调 settlePayment → handler
 *    'aggregate' 方法未注册 PaymentMethodHandler，会报 not-found
 *    故 Authorized → Settled 直接改 state + 手动 transition Order
 * 3. Order transitionToState 的 checkPaymentsCoverTotal 会校验已结算支付覆盖总额
 * 4. onTransitionEnd 会在 Payment 全部 Settled 时自动 transition Order 到 PaymentSettled
 *
 * 事务内必须用 transactionalConnection.getRepository(txCtx, Entity) 而非
 * connection.getRepository(Entity)，否则操作不在事务中。
 *
 * customFields 是 embedded entity（CustomPaymentFields），不能用
 * repository.update(id, { [colName]: val }) 更新——TypeORM update 接收的是
 * entity property 名而非列名。正确做法：load → modify → save。
 */
export declare class AggregatePayService {
    private connection;
    private transactionalConnection;
    private orderService;
    private paymentService;
    private posOrderService;
    constructor(connection: Connection, transactionalConnection: TransactionalConnection, orderService: OrderService, paymentService: PaymentService, posOrderService: PosOrderService);
    /**
     * 创建聚合码待支付 Payment。
     * 1. 确保 session 有活跃 Order
     * 2. Order → ArrangingPayment
     * 3. 创建 Payment(state=Created, method=aggregate, customFields.aggregatePayStatus=pending)
     * 4. 添加 Payment 到 Order.payments 关系
     * 返回 Payment，Order 仍处于 ArrangingPayment 状态。
     */
    createPendingPayment(ctx: RequestContext, session: PosSession, input: {
        aggregatePayCode: string;
    }): Promise<Payment>;
    /**
     * 确认聚合码支付（客户已扫码付款）。
     * Payment: Created → Authorized（PaymentService.transitionToState 支持，不走 handler）
     * Order: 自动 transition 到 PaymentAuthorized（由 onTransitionEnd 触发）
     */
    confirmPayment(ctx: RequestContext, paymentId: ID): Promise<Payment>;
    /**
     * 结算聚合码支付（关班时批量结算）。
     * Payment: Authorized → Settled（直接改 state，绕过 handler）
     * Order: 手动 transition 到 PaymentSettled
     */
    settlePayment(ctx: RequestContext, paymentId: ID): Promise<Payment>;
    /**
     * 标记聚合码支付失败（超时）。
     * Payment: Created → Cancelled（直接改 state）
     * Order: ArrangingPayment → AddingItems（退回购物车状态）
     */
    failPayment(ctx: RequestContext, paymentId: ID): Promise<Payment>;
    /**
     * 批量结算班次内所有 confirmed 状态的聚合码支付。
     * 关班时调用，返回成功笔数与逐笔失败原因（失败不再静默丢弃）。
     */
    settleSessionPayments(ctx: RequestContext, sessionId: number): Promise<SettleSessionAggregatePaysResult>;
    /**
     * 根据聚合码查找待支付 Payment。
     */
    findByCode(aggregatePayCode: string): Promise<Payment | null>;
    private findPaymentOrThrow;
    /**
     * 更新 Payment.customFields.aggregatePayStatus。
     *
     * customFields 是 embedded entity（CustomPaymentFields），TypeORM 的
     * repository.update(id, { colName: val }) 接收的是 entity property 名
     * 而非列名，直接用 PRAGMA 列名做 key 无法正确映射到 embedded 属性。
     * 正确做法：load entity → modify customFields → save entity。
     *
     * @param ctx 传入调用方的事务上下文；在 withTransaction 内必须传 txCtx。
     *            若此处固定用 this.connection，独立连接更新同一 payment 行会等待
     *            外层事务持有的行锁，而外层又在等本函数返回 → 跨连接自锁。
     */
    private updateAggregatePayStatus;
}
