import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import {
  ID,
  Logger,
  Order,
  OrderService,
  Payment,
  PaymentService,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { Connection } from 'typeorm';

import { AGGREGATE_PAY_STATUS } from '../constants';
import { PosSession } from '../entities/pos-session.entity';
import { SettleSessionAggregatePaysResult } from '../types';
import { PosOrderService } from './pos-order.service';
import { findDbColumn } from './db-columns';

const loggerCtx = 'AggregatePayService';

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
@Injectable()
export class AggregatePayService {
  constructor(
    @InjectConnection() private connection: Connection,
    @Inject(TransactionalConnection)
    private transactionalConnection: TransactionalConnection,
    @Inject(OrderService) private orderService: OrderService,
    @Inject(PaymentService) private paymentService: PaymentService,
    @Inject(PosOrderService) private posOrderService: PosOrderService,
  ) {}

  /**
   * 创建聚合码待支付 Payment。
   * 1. 确保 session 有活跃 Order
   * 2. Order → ArrangingPayment
   * 3. 创建 Payment(state=Created, method=aggregate, customFields.aggregatePayStatus=pending)
   * 4. 添加 Payment 到 Order.payments 关系
   * 返回 Payment，Order 仍处于 ArrangingPayment 状态。
   */
  async createPendingPayment(
    ctx: RequestContext,
    session: PosSession,
    input: { aggregatePayCode: string },
  ): Promise<Payment> {
    const order = await this.posOrderService.ensureActiveOrder(ctx, session);
    if (order.lines.length === 0) {
      throw new UserInputError('购物车为空，无法发起聚合码支付');
    }

    // Order → ArrangingPayment
    const arrangeResult = await this.orderService.transitionToState(
      ctx,
      order.id,
      'ArrangingPayment',
    );
    if ('errorCode' in arrangeResult) {
      throw new UserInputError(`转入 ArrangingPayment 失败: ${arrangeResult.message}`);
    }

    // 创建 Payment in Created state
    const payment = new Payment({
      amount: order.totalWithTax,
      order,
      method: 'aggregate',
      state: 'Created',
      metadata: { aggregatePayCode: input.aggregatePayCode } as any,
    });
    (payment as any).customFields = {
      aggregatePayCode: input.aggregatePayCode,
      aggregatePayStatus: AGGREGATE_PAY_STATUS.PENDING,
      needsManualRefund: false,
      posSessionId: session.id,
    };
    const saved = await this.connection.getRepository(Payment).save(payment);

    // 添加到 Order.payments 关系
    await this.connection
      .getRepository(Order)
      .createQueryBuilder()
      .relation('payments')
      .of(order)
      .add(saved);

    return saved;
  }

  /**
   * 确认聚合码支付（客户已扫码付款）。
   * Payment: Created → Authorized（PaymentService.transitionToState 支持，不走 handler）
   * Order: 自动 transition 到 PaymentAuthorized（由 onTransitionEnd 触发）
   */
  async confirmPayment(ctx: RequestContext, paymentId: ID): Promise<Payment> {
    const payment = await this.findPaymentOrThrow(paymentId);
    if (payment.state !== 'Created') {
      throw new UserInputError(
        `Payment ${paymentId} 状态为 ${payment.state}，无法确认（需 Created）`,
      );
    }

    // Created → Authorized（PaymentService 对非 Settled/Cancelled 状态直接用 state machine）
    const result = await this.paymentService.transitionToState(
      ctx,
      paymentId,
      'Authorized',
    );
    if ('errorCode' in result) {
      throw new UserInputError(`确认支付失败: ${result.message}`);
    }

    // 更新 customFields.aggregatePayStatus
    await this.updateAggregatePayStatus(ctx, paymentId, AGGREGATE_PAY_STATUS.CONFIRMED);

    return this.findPaymentOrThrow(paymentId);
  }

  /**
   * 结算聚合码支付（关班时批量结算）。
   * Payment: Authorized → Settled（直接改 state，绕过 handler）
   * Order: 手动 transition 到 PaymentSettled
   */
  async settlePayment(ctx: RequestContext, paymentId: ID): Promise<Payment> {
    const payment = await this.findPaymentOrThrow(paymentId, ['order']);
    if (payment.state !== 'Authorized') {
      throw new UserInputError(
        `Payment ${paymentId} 状态为 ${payment.state}，无法结算（需 Authorized）`,
      );
    }

    await this.transactionalConnection.withTransaction(ctx, async txCtx => {
      // 1. 直接更新 Payment.state = 'Settled'（用事务连接）
      payment.state = 'Settled';
      await this.transactionalConnection
        .getRepository(txCtx, Payment)
        .save(payment, { reload: false });

      // 2. 更新 customFields.aggregatePayStatus（load-modify-save）
      //    必须传 txCtx：用独立连接更新同一 payment 行会等待本事务持有的行锁，
      //    而本事务又在等这个调用返回 —— 形成跨连接自锁（批量结算卡住）。
      await this.updateAggregatePayStatus(txCtx, paymentId, AGGREGATE_PAY_STATUS.SETTLED);

      // 3. 手动 transition Order → PaymentSettled
      //    checkPaymentsCoverTotal 会校验已结算支付覆盖总额
      const order = payment.order;
      if (order.state !== 'PaymentSettled') {
        const result = await this.orderService.transitionToState(
          txCtx,
          order.id,
          'PaymentSettled',
        );
        if ('errorCode' in result) {
          throw new UserInputError(
            `Order transition 到 PaymentSettled 失败: ${result.message}`,
          );
        }
      }

      // 4. 清除 session.activeOrderId（同一事务）
      //    放在事务外会在「支付已 Settled + 订单已 PaymentSettled」之后留下
      //    「会话仍指向已结算订单」的半完成态：若该更新失败，调用方按失败处理，
      //    但重试时 Payment 已非 Authorized 直接报错，无法自愈。
      const sessionRepo = this.transactionalConnection.getRepository(txCtx, PosSession);
      const session = await sessionRepo.findOne({
        where: { activeOrderId: Number(order.id) },
      });
      if (session) {
        await sessionRepo.update(session.id, { activeOrderId: null });
      }
    });

    return this.findPaymentOrThrow(paymentId);
  }

  /**
   * 标记聚合码支付失败（超时）。
   * Payment: Created → Cancelled（直接改 state）
   * Order: ArrangingPayment → AddingItems（退回购物车状态）
   */
  async failPayment(ctx: RequestContext, paymentId: ID): Promise<Payment> {
    const payment = await this.findPaymentOrThrow(paymentId, ['order']);
    if (payment.state !== 'Created') {
      throw new UserInputError(
        `Payment ${paymentId} 状态为 ${payment.state}，无法标记失败（需 Created）`,
      );
    }

    await this.transactionalConnection.withTransaction(ctx, async txCtx => {
      // 1. 直接更新 Payment.state = 'Cancelled'（用事务连接）
      payment.state = 'Cancelled';
      await this.transactionalConnection
        .getRepository(txCtx, Payment)
        .save(payment, { reload: false });

      // 2. 更新 customFields.aggregatePayStatus（load-modify-save）
      await this.updateAggregatePayStatus(txCtx, paymentId, AGGREGATE_PAY_STATUS.FAILED);

      // 3. Order: ArrangingPayment → AddingItems
      const order = payment.order;
      if (order.state === 'ArrangingPayment') {
        const result = await this.orderService.transitionToState(
          txCtx,
          order.id,
          'AddingItems',
        );
        if ('errorCode' in result) {
          throw new UserInputError(
            `Order 退回 AddingItems 失败: ${result.message}`,
          );
        }
      }
    });

    return this.findPaymentOrThrow(paymentId);
  }

  /**
   * 批量结算班次内所有 confirmed 状态的聚合码支付。
   * 关班时调用，返回成功笔数与逐笔失败原因（失败不再静默丢弃）。
   */
  async settleSessionPayments(
    ctx: RequestContext,
    sessionId: number,
  ): Promise<SettleSessionAggregatePaysResult> {
    // 查找班次内所有 aggregatePayStatus='confirmed' 的 Payment
    // Payment.customFields 是 embedded entity，动态查找实际列名
    const statusCol = await findDbColumn(this.connection, 'payment', 'aggregatePayStatus');
    const sessionCol = await findDbColumn(this.connection, 'payment', 'posSessionId');

    if (!statusCol || !sessionCol) {
      Logger.warn(
        `[aggregatePay] 无法定位聚合码支付列（statusCol=${statusCol}, sessionCol=${sessionCol}），批量结算跳过`,
        loggerCtx,
      );
      return { settled: 0, failed: [] };
    }

    const payments = (await this.connection
      .getRepository(Payment)
      .createQueryBuilder('pay')
      .leftJoinAndSelect('pay.order', 'ord')
      .where(`pay."${statusCol}" = :status`, {
        status: AGGREGATE_PAY_STATUS.CONFIRMED,
      })
      .andWhere(`pay."${sessionCol}" = :sid`, { sid: sessionId })
      .getMany()) as Payment[];

    let settled = 0;
    const failed: Array<{ paymentId: string; reason: string }> = [];
    for (const payment of payments) {
      try {
        await this.settlePayment(ctx, payment.id);
        settled++;
      } catch (e) {
        // 单笔失败不阻断其他笔，但必须上报原因，不能静默计数
        const reason = e instanceof Error ? e.message : String(e);
        failed.push({ paymentId: String(payment.id), reason });
        Logger.warn(
          `[aggregatePay] 批量结算失败 paymentId=${payment.id}: ${reason}`,
          loggerCtx,
        );
      }
    }
    return { settled, failed };
  }

  /**
   * 根据聚合码查找待支付 Payment。
   */
  async findByCode(aggregatePayCode: string): Promise<Payment | null> {
    // 查找 customFields.aggregatePayCode = code 的 Payment
    const codeCol = await findDbColumn(this.connection, 'payment', 'aggregatePayCode');

    if (!codeCol) return null;

    return this.connection
      .getRepository(Payment)
      .createQueryBuilder('pay')
      .leftJoinAndSelect('pay.order', 'ord')
      .where(`pay."${codeCol}" = :code`, { code: aggregatePayCode })
      .getOne();
  }

  private async findPaymentOrThrow(
    paymentId: ID,
    relations: string[] = [],
  ): Promise<Payment> {
    const payment = await this.connection.getRepository(Payment).findOne({
      where: { id: paymentId },
      relations: relations.length > 0 ? relations : undefined,
    });
    if (!payment) {
      throw new UserInputError(`Payment ${paymentId} 不存在`);
    }
    return payment;
  }

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
  private async updateAggregatePayStatus(
    ctx: RequestContext,
    paymentId: ID,
    status: string,
  ): Promise<void> {
    const repo = this.transactionalConnection.getRepository(ctx, Payment);
    const payment = await repo.findOne({
      where: { id: paymentId },
    });
    if (!payment) {
      Logger.warn(
        `[aggregatePay] 更新聚合码支付状态时找不到 paymentId=${paymentId}（目标状态 ${status}）`,
        loggerCtx,
      );
      return;
    }

    (payment as any).customFields = {
      ...((payment as any).customFields ?? {}),
      aggregatePayStatus: status,
    };
    await repo.save(payment);
  }
}
