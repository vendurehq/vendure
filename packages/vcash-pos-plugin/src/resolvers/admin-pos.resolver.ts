import { Inject } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  AdministratorService,
  Allow,
  Ctx,
  ID,
  Order,
  Payment,
  RequestContext,
  UserInputError,
} from '@vendure/core';

import { posSessionPermission } from '../constants';
import { PosSession, ShiftSummary } from '../entities/pos-session.entity';
import { SettleSessionAggregatePaysResult } from '../types';
import { AggregatePayService } from '../services/aggregate-pay.service';
import { PosOrderService } from '../services/pos-order.service';
import { PosSessionService } from '../services/pos-session.service';
import { ShiftReportService } from '../services/shift-report.service';

/**
 * POS 收银操作 API：班次生命周期（开班/关班/我的班次）+ 交班对账预览 + 聚合码支付。
 */
@Resolver()
export class AdminPosResolver {
  constructor(
    @Inject(PosSessionService) private sessionService: PosSessionService,
    @Inject(AdministratorService) private administratorService: AdministratorService,
    @Inject(PosOrderService) private orderService: PosOrderService,
    @Inject(ShiftReportService) private shiftReportService: ShiftReportService,
    @Inject(AggregatePayService) private aggregatePayService: AggregatePayService,
  ) {}

  /**
   * 当前管理员的开班班次。
   * ctx.activeUserId 是 User.id，需先转成 Administrator.id 再查。
   */
  @Query()
  @Allow(posSessionPermission.Read)
  async myPosSession(@Ctx() ctx: RequestContext): Promise<PosSession | null> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) return null;
    return this.sessionService.findMyOpenSession(Number(admin.id));
  }

  @Query()
  @Allow(posSessionPermission.Read)
  async posSession(@Args('id') id: string): Promise<PosSession | null> {
    return this.sessionService.findOne(parseInt(id, 10));
  }

  @Mutation()
  @Allow(posSessionPermission.Create)
  async openSession(
    @Args('input') input: { terminalCode: string; openingFloat?: number },
    @Ctx() ctx: RequestContext,
  ): Promise<PosSession> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    return this.sessionService.openSession({
      terminalCode: input.terminalCode,
      operatorId: Number(admin.id),
      openingFloat: input.openingFloat,
    });
  }

  @Mutation()
  @Allow(posSessionPermission.Update)
  async closeSession(
    @Args('input') input: {
      sessionId: string;
      closingCash?: number;
      approverId?: string;
    },
  ): Promise<{ session: PosSession; summary: any | null }> {
    const session = await this.sessionService.closeSession({
      sessionId: parseInt(input.sessionId, 10),
      closingCash: input.closingCash ?? 0,
      approverId: input.approverId ? parseInt(input.approverId, 10) : undefined,
    });
    return { session, summary: session.closeSummary };
  }

  @Query()
  @Allow(posSessionPermission.Read)
  async posActiveOrder(@Ctx() ctx: RequestContext): Promise<Order | null> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) return null;
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) return null;
    // ensureActiveOrder 会复用已有 activeOrderId 或创建新 Order（结账后 activeOrderId 已清，会创建新空 Order）
    return this.orderService.ensureActiveOrder(ctx, session);
  }

  @Mutation()
  @Allow(posSessionPermission.Update)
  async addPosItem(
    @Args('input') input: {
      productVariantId: string;
      quantity: number;
      discount?: number;
      isGift?: boolean;
      note?: string;
      originalPrice?: number;
    },
    @Ctx() ctx: RequestContext,
  ): Promise<Order> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.orderService.addPosItem(ctx, session, {
      productVariantId: input.productVariantId,
      quantity: input.quantity,
      discount: input.discount,
      isGift: input.isGift,
      note: input.note,
      originalPrice: input.originalPrice,
    });
  }

  @Mutation()
  @Allow(posSessionPermission.Update)
  async updatePosItem(
    @Args('input') input: { orderLineId: string; quantity: number },
    @Ctx() ctx: RequestContext,
  ): Promise<Order> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.orderService.updatePosItem(ctx, session, {
      orderLineId: input.orderLineId,
      quantity: input.quantity,
    });
  }

  @Mutation()
  @Allow(posSessionPermission.Update)
  async checkoutPosOrder(
    @Args('input') input: {
      payments: Array<{ method: string; transactionId?: string; metadata?: any }>;
    },
    @Ctx() ctx: RequestContext,
  ): Promise<{ order: Order; payments: any[] }> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.orderService.checkoutPosOrder(ctx, session, input);
  }

  /**
   * 交班对账单预览：不传 closingCash 则不做现金对账（warnings 为空）。
   * 用于关班前让收银员预览当前班次汇总。
   */
  @Query()
  @Allow(posSessionPermission.Read)
  async shiftReportPreview(
    @Args('sessionId') sessionId: string,
    @Args('closingCash') closingCash?: number,
  ): Promise<ShiftSummary> {
    return this.shiftReportService.generateSummary(
      parseInt(sessionId, 10),
      closingCash,
    );
  }

  // ===== 聚合码支付 =====

  /**
   * 创建聚合码待支付 Payment。
   * 需当前班次有活跃 Order 且购物车非空。
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async createAggregatePay(
    @Args('input') input: { aggregatePayCode: string },
    @Ctx() ctx: RequestContext,
  ): Promise<Payment> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.aggregatePayService.createPendingPayment(ctx, session, input);
  }

  /**
   * 确认聚合码支付（客户已扫码付款）。
   * Payment: Created → Authorized
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async confirmAggregatePay(
    @Args('paymentId') paymentId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<Payment> {
    return this.aggregatePayService.confirmPayment(ctx, paymentId);
  }

  /**
   * 结算聚合码支付（关班时批量结算或单笔结算）。
   * Payment: Authorized → Settled
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async settleAggregatePay(
    @Args('paymentId') paymentId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<Payment> {
    return this.aggregatePayService.settlePayment(ctx, paymentId);
  }

  /**
   * 标记聚合码支付失败（超时）。
   * Payment: Created → Cancelled
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async failAggregatePay(
    @Args('paymentId') paymentId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<Payment> {
    return this.aggregatePayService.failPayment(ctx, paymentId);
  }

  /**
   * 批量结算班次内所有 confirmed 状态的聚合码支付。
   * 返回 { settled, failed }，失败逐笔带原因。
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async settleSessionAggregatePays(
    @Args('sessionId') sessionId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<SettleSessionAggregatePaysResult> {
    return this.aggregatePayService.settleSessionPayments(
      ctx,
      parseInt(sessionId, 10),
    );
  }

  /**
   * 根据聚合码查询 Payment 状态。
   */
  @Query()
  @Allow(posSessionPermission.Read)
  async aggregatePayByCode(
    @Args('aggregatePayCode') aggregatePayCode: string,
  ): Promise<Payment | null> {
    return this.aggregatePayService.findByCode(aggregatePayCode);
  }

  // ===== Phase 5: 退货与挂单 =====

  /**
   * 挂单：把当前活跃 Order 的 orderType 改为 hold，清空 activeOrderId。
   * 无参数（操作当前 session 的 activeOrder）。
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async holdOrder(@Ctx() ctx: RequestContext): Promise<Order> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.orderService.holdOrder(ctx, session);
  }

  /**
   * 取单：校验目标 Order 为 hold + 归属本终端，加载为当前 activeOrder。
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async resumeOrder(
    @Args('orderId') orderId: string,
    @Ctx() ctx: RequestContext,
  ): Promise<Order> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.orderService.resumeOrder(ctx, session, orderId);
  }

  /**
   * 挂单列表：当前终端下所有 orderType=hold 的 Draft Order。
   */
  @Query()
  @Allow(posSessionPermission.Read)
  async heldOrders(@Ctx() ctx: RequestContext): Promise<Order[]> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) return [];
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) return [];
    return this.orderService.findHeldOrders(ctx, session);
  }

  /**
   * 按订单号查询原单（退货场景入口）。Admin API 无原生 orderByCode，此处封装。
   */
  @Query()
  @Allow(posSessionPermission.Read)
  async posOrderByCode(
    @Args('code') code: string,
    @Ctx() ctx: RequestContext,
  ): Promise<Order | null> {
    return this.orderService.findByCode(ctx, code);
  }

  /**
   * 创建退货单（独立 refund Order，spec 3.10）：
   * 复制原单行为负数量 + createCancellationsForOrderLines 回库 + 现金退款 Payment。
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async createRefundOrder(
    @Args('input')
    input: {
      originalOrderId: string;
      refundLines: Array<{ orderLineId: string; quantity: number; reason?: string }>;
    },
    @Ctx() ctx: RequestContext,
  ): Promise<{ refundOrder: Order; originalOrder: Order }> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) throw new UserInputError('当前无开班班次');
    return this.orderService.createRefundOrder(ctx, session, {
      originalOrderId: input.originalOrderId,
      refundLines: input.refundLines,
    });
  }

  /**
   * User.id → Administrator。失败返回 undefined（myPosSession 容忍 null，openSession 抛错）。
   */
  private async resolveOperator(ctx: RequestContext) {
    const userId = ctx.activeUserId;
    if (!userId) return undefined;
    return this.administratorService.findOneByUserId(ctx, userId);
  }
}
