import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import {
  ID,
  Order,
  OrderService,
  Payment,
  Refund,
  RequestContext,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { Connection, In } from 'typeorm';

import { findDbColumn } from './db-columns';

/**
 * 退货退款服务：
 * - createRefund: 调用 OrderService.refundOrder 创建 Refund
 *   - 现金支付：立即 settleRefund（当场退现金）
 *   - 聚合码支付：标记 metadata.needsManualRefund=true（需人工退款）
 * - settleManualRefund: 手动结算待处理退款（聚合码已结算的）
 *
 * 关键 API（Vendure 3.6.4）：
 * 1. OrderService.refundOrder(ctx, { paymentId, amount, reason }) → Refund
 *    要求 Order 状态为 PaymentSettled / PaymentAuthorized / Completed / PartiallyShipped 等
 * 2. OrderService.settleRefund(ctx, { id, transactionId }) → Refund (state=Settled)
 * 3. Refund.total 为负数（退款金额的负值），state: Pending → Settled | Failed
 */
@Injectable()
export class RefundService {
  constructor(
    @InjectConnection() private connection: Connection,
    @Inject(TransactionalConnection)
    private transactionalConnection: TransactionalConnection,
    @Inject(OrderService) private orderService: OrderService,
  ) {}

  /**
   * 创建退货退款。
   * @param input.originalOrderId 原销售单 ID
   * @param input.paymentId 原单上的 Payment ID（退款挂在哪个 Payment 上）
   * @param input.amount 退款金额（分，正数）
   * @param input.reason 退款原因
   */
  async createRefund(
    ctx: RequestContext,
    input: {
      originalOrderId: ID;
      paymentId: ID;
      amount: number;
      reason?: string;
    },
  ): Promise<Refund> {
    // 1. 校验原单存在且可退款
    const order = await this.orderService.findOne(ctx, input.originalOrderId, [
      'payments',
    ]);
    if (!order) {
      throw new UserInputError(`订单 ${input.originalOrderId} 不存在`);
    }

    const refundableStates = [
      'PaymentSettled',
      'PaymentAuthorized',
      'PartiallyShipped',
      'Shipped',
      'PartiallyDelivered',
      'Delivered',
      'Cancelled',
      'Modifying',
      'ArrangingAdditionalPayment',
    ];
    if (!refundableStates.includes(order.state)) {
      throw new UserInputError(
        `订单状态 ${order.state} 不支持退款（需 PaymentSettled 等已完成状态）`,
      );
    }

    // 2. 校验 Payment 属于该 Order
    const payment = order.payments?.find(p => String(p.id) === String(input.paymentId));
    if (!payment) {
      throw new UserInputError(
        `Payment ${input.paymentId} 不属于订单 ${input.originalOrderId}`,
      );
    }

    // 3. COD：只认 confirmed 收款，统一走 campus 闸门（无收款不建单；有收款建单即 Settled）
    if (String(payment.method) === 'cash-on-delivery') {
      const policy = resolveCodRefundPolicy();
      if (!policy) {
        throw new UserInputError('COD 退款闸门不可用：无收款记录能力，拒绝创建退款单');
      }
      const result: any = await policy.createRefund(ctx, {
        orderId: order.id,
        paymentId: payment.id,
        amount: input.amount,
        reason: input.reason ?? 'POS 退货退款',
      });
      if (result instanceof Error || result?.errorCode) {
        throw new UserInputError(`创建退款失败: ${result?.message ?? result?.errorCode ?? '未知原因'}`);
      }
      return this.connection.getRepository(Refund).findOne({
        where: { id: (result as any).id },
        relations: ['payment', 'payment.order'],
      }) as Promise<Refund>;
    }

    // 4. 调用 OrderService.refundOrder 创建 Refund
    //    Refund 实体的 shipping/adjustment 字段虽 @deprecated 但仍 NOT NULL，
    //    必须显式传 0 避免 "NOT NULL constraint failed: refund.shipping"
    const refundResult = await this.orderService.refundOrder(ctx, {
      paymentId: input.paymentId,
      amount: input.amount,
      reason: input.reason ?? 'POS 退货退款',
      shipping: 0,
      adjustment: 0,
    } as any);

    if ('errorCode' in refundResult) {
      throw new UserInputError(`创建退款失败: ${refundResult.message}`);
    }

    // 4. 根据 Payment.method 决定退款方式
    if (payment.method === 'cash') {
      // 现金：立即结算退款（当场退现金）
      await this.orderService.settleRefund(ctx, {
        id: refundResult.id,
        transactionId: `cash-refund-${Date.now()}`,
      });
    } else if (payment.method === 'aggregate') {
      // 聚合码：标记需人工退款
      await this.connection.getRepository(Refund).update(refundResult.id, {
        metadata: {
          ...(refundResult.metadata ?? {}),
          needsManualRefund: true,
          originalPaymentMethod: 'aggregate',
        } as any,
      });
    }

    // 5. 返回最新 Refund
    return this.connection.getRepository(Refund).findOne({
      where: { id: refundResult.id },
      relations: ['payment', 'payment.order'],
    }) as Promise<Refund>;
  }

  /**
   * 手动结算退货退款（聚合码已结算的需人工处理）。
   */
  async settleManualRefund(
    ctx: RequestContext,
    input: { refundId: ID; transactionId: string },
  ): Promise<Refund> {
    const refund = await this.connection.getRepository(Refund).findOne({
      where: { id: input.refundId },
    });
    if (!refund) {
      throw new UserInputError(`退款单 ${input.refundId} 不存在`);
    }
    if (refund.state !== 'Pending') {
      throw new UserInputError(
        `退款单 ${input.refundId} 状态为 ${refund.state}，无法结算（需 Pending）`,
      );
    }

    return this.orderService.settleRefund(ctx, {
      id: input.refundId,
      transactionId: input.transactionId,
    });
  }

  /**
   * 查询班次内所有退款单（通过 Payment → Order → customFields.posSessionId）。
   * 返回的 Refund 已加载 payment 关系，供 GraphQL Refund.payment 解析。
   */
  async findRefundsBySession(sessionId: number): Promise<Refund[]> {
    // 查找 order 表的 posSessionId 列名（SQLite/PostgreSQL 通用）
    const sessionCol = await findDbColumn(this.connection, 'order', 'posSessionId');

    if (!sessionCol) return [];

    // 查找属于该班次的 Order IDs
    const orders = await this.connection
      .getRepository(Order)
      .createQueryBuilder('ord')
      .where(`ord."${sessionCol}" = :sid`, { sid: sessionId })
      .getMany();

    if (orders.length === 0) return [];

    const orderIds = orders.map(o => o.id);

    // 查找这些 Orders 的 Payments
    const payments = await this.connection
      .getRepository(Payment)
      .createQueryBuilder('pay')
      .leftJoinAndSelect('pay.refunds', 'refund')
      .where('pay.orderId IN (:...orderIds)', { orderIds })
      .getMany();

    // 收集 refund IDs，再批量加载 refund + payment 关系
    // （inverse side 关系不会随 leftJoinAndSelect 一起加载到 refund 实体上）
    const refundIds: number[] = [];
    for (const payment of payments) {
      if (payment.refunds) {
        refundIds.push(...payment.refunds.map(r => Number(r.id)));
      }
    }

    if (refundIds.length === 0) return [];

    return this.connection.getRepository(Refund).find({
      where: { id: In(refundIds) },
      relations: ['payment'],
    });
  }
}

/** 软依赖解析 COD 退款闸门端口（campus/cjk 未安装时返回 null，COD 一律不建退款单）。 */
function resolveCodRefundPolicy(): {
  createRefund(ctx: RequestContext, input: any): Promise<any>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@vendure/cjk-plugin');
    return typeof mod?.getCodRefundPolicyPort === 'function' ? mod.getCodRefundPolicyPort() : null;
  } catch {
    return null;
  }
}
