import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Order, Payment, Refund } from '@vendure/core';
import { Connection } from 'typeorm';

import { PosSession, ShiftSummary } from '../entities/pos-session.entity';
import { ORDER_TYPE } from '../constants';
import { RefundService } from './refund.service';
import { findDbColumn } from './db-columns';

/**
 * 交班对账服务：
 * - 聚合班次内所有 Order（通过 Order.customFields.posSessionId 关联）
 * - 按 orderType 分组统计（sale/refund/hold）
 * - 按 Payment.method 聚合支付明细（count + amount）
 * - 现金对账：expectedCash = openingFloat + Σ(cash payment amount)
 *   若 closingCash 与 expectedCash 差额 > 1 分则产生 warning
 *
 * 关键实现细节（Vendure 3.6.4）：
 * 1. Custom fields 是 embedded entity，列名形如 `customFields_posSessionId`
 *    不能用 `customFieldsJson ->> '$.posSessionId'` 的 JSON 查询
 * 2. Payment.amount 用 @Money 装饰器，单位为分（int）
 * 3. Order.total 为计算字段（subTotal + shipping），需 select 实体后访问 getter
 * 4. 退货 Order 的 total 为负数，统计 refundAmount 取 Math.abs
 */
@Injectable()
export class ShiftReportService {
  constructor(
    @InjectConnection() private connection: Connection,
    @Inject(RefundService) private refundService: RefundService,
  ) {}

  /**
   * 生成班次对账单。
   * @param sessionId 班次 ID
   * @param closingCash 实交现金（分），可选；传入则进行现金对账
   */
  async generateSummary(
    sessionId: number,
    closingCash?: number,
  ): Promise<ShiftSummary> {
    // 1. 查询班次内所有 Order（含 payments 关系）
    //    使用 raw SQL 查找实际列名后查询，避免 TypeORM 命名策略差异
    const orders = await this.queryOrdersBySession(sessionId);

    // 2. 按 orderType 分组
    const normalOrders = orders.filter(
      o => (o.customFields as any)?.orderType === ORDER_TYPE.SALE,
    );
    const refundOrders = orders.filter(
      o => (o.customFields as any)?.orderType === ORDER_TYPE.REFUND,
    );
    const heldOrders = orders.filter(
      o => (o.customFields as any)?.orderType === ORDER_TYPE.HOLD,
    );

    // 3. 金额汇总（Order.total 为 getter，单位分）
    const totalAmount = normalOrders.reduce((s, o) => s + (o.total ?? 0), 0);
    const refundOrderAmount = refundOrders.reduce(
      (s, o) => s + Math.abs(o.total ?? 0),
      0,
    );

    // 3b. 查询班次内原生 Refund（Vendure refundOrder 机制，非退货 Order）
    const nativeRefunds = await this.refundService.findRefundsBySession(sessionId);
    const nativeRefundAmount = nativeRefunds
      .filter(r => r.state === 'Settled')
      .reduce((s, r) => s + Math.abs(r.total ?? 0), 0);
    const refundAmount = refundOrderAmount + nativeRefundAmount;

    // 4. 支付方式聚合：遍历所有 Order 的 payments，按 method 分组
    //    只统计 state='Settled' 的支付（避免 Created/Error 干扰）
    const methodMap = new Map<string, { count: number; amount: number }>();
    for (const order of orders) {
      for (const payment of order.payments ?? []) {
        if (payment.state !== 'Settled') continue;
        const entry = methodMap.get(payment.method) ?? {
          count: 0,
          amount: 0,
        };
        entry.count += 1;
        entry.amount += payment.amount;
        methodMap.set(payment.method, entry);
      }
    }
    // 4b. 退款冲减支付方式统计（原生 Refund 的负金额冲减对应 method）
    for (const refund of nativeRefunds) {
      if (refund.state !== 'Settled') continue;
      const method = refund.method || refund.payment?.method || 'unknown';
      const entry = methodMap.get(method) ?? { count: 0, amount: 0 };
      entry.amount -= Math.abs(refund.total ?? 0);
      methodMap.set(method, entry);
    }
    const paymentsByMethod = Array.from(methodMap.entries()).map(
      ([method, v]) => ({ method, ...v }),
    );

    // 5. 现金对账
    const warnings: string[] = [];
    if (closingCash !== undefined) {
      const session = await this.connection
        .getRepository(PosSession)
        .findOne({ where: { id: sessionId } });
      const openingFloat = session?.openingFloat ?? 0;
      const expectedCash = await this.calculateExpectedCash(
        orders,
        openingFloat,
        nativeRefunds,
        sessionId,
      );
      const diff = closingCash - expectedCash;
      if (Math.abs(diff) > 1) {
        const sign = diff > 0 ? '长' : '短';
        warnings.push(
          `现金${sign}款 ${Math.abs(diff).toFixed(2)} 分（应交 ${expectedCash}，实交 ${closingCash}）`,
        );
      }
    }

    return {
      orders: {
        totalCount: orders.length,
        totalAmount,
        normalCount: normalOrders.length,
        refundCount: refundOrders.length + nativeRefunds.length,
        refundAmount,
        heldCount: heldOrders.length,
      },
      paymentsByMethod,
      warnings,
    };
  }

  /**
   * 计算应收现金 = openingFloat + Σ(method='cash' 且 state='Settled' 的 payment.amount)。
   * 退货 Order 的 cash payment 金额为负，会自动冲减。
   * 原生 Refund 中 method='cash' 且 state='Settled' 的退款也需冲减。
   */
  private async calculateExpectedCash(
    orders: Order[],
    openingFloat: number,
    nativeRefunds: Refund[],
    sessionId: number,
  ): Promise<number> {
    let cashFromPayments = 0;
    for (const order of orders) {
      for (const payment of order.payments ?? []) {
        if (payment.state !== 'Settled') continue;
        if (payment.method === 'cash') {
          cashFromPayments += payment.amount;
        }
      }
    }
    // 原生现金退款冲减
    for (const refund of nativeRefunds) {
      if (refund.state !== 'Settled') continue;
      const method = refund.method || refund.payment?.method || '';
      if (method === 'cash') {
        cashFromPayments -= Math.abs(refund.total ?? 0);
      }
    }
    return openingFloat + cashFromPayments;
  }

  /**
   * 查询班次内所有 Order（含 payments 关系）。
   *
   * TypeORM 对 embedded custom field 列名的解析在不同测试环境下不稳定
   * （dot notation 'ord.customFields.posSessionId' 在部分环境下被错误解析为
   * 'customFieldsPossessionid'）。此处用 PRAGMA 动态查找实际列名后查询。
   */
  private async queryOrdersBySession(sessionId: number): Promise<Order[]> {
    // 1. 动态查找 order 表中 posSessionId 的实际列名（SQLite/PostgreSQL 通用）
    const colName = await findDbColumn(this.connection, 'order', 'posSessionId');

    if (!colName) {
      // 列不存在（schema 未同步 custom field），返回空数组
      return [];
    }

    // 2. 用实际列名查询 Order（含 payments 关系）
    return this.connection
      .getRepository(Order)
      .createQueryBuilder('ord')
      .leftJoinAndSelect('ord.payments', 'payment')
      .where(`ord."${colName}" = :sid`, { sid: sessionId })
      .getMany();
  }
}
