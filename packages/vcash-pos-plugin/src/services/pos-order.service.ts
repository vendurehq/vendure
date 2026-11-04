import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import {
  Customer,
  ID,
  Order,
  OrderLine,
  OrderService,
  RequestContext,
  StockMovementService,
  TransactionalConnection,
  UserInputError,
  idsAreEqual,
} from '@vendure/core';
import { Connection } from 'typeorm';

import { PosSession } from '../entities/pos-session.entity';
import { MemberPriceCalculator } from './member-price-calculator';
import { PromotionEngineService } from './promotion-engine.service';

export interface CreateOrderFromOfflineInput {
  terminalCode: string;
  orderType: string;
  lines: Array<{
    productVariantId: ID;
    quantity: number;
    discount?: number;
    isGift?: boolean;
    note?: string;
    originalPrice?: number;
  }>;
  payments: Array<{
    method: string;
    transactionId?: string;
    metadata?: any;
  }>;
}

/**
 * POS 收银核心服务：
 * - ensureActiveOrder: 班次内有活跃 Order 则复用，否则创建新 Order 并绑定 custom fields
 * - addPosItem: 加商品到 Order，通过 addItemToOrder 第 5 参设置 OrderLine custom fields
 * - updatePosItem: 修改 OrderLine 数量
 * - checkoutPosOrder: transitionToState ArrangingPayment → addManualPaymentToOrder → transitionToState PaymentSettled
 *
 * 关键 API 约束（Vendure 3.6.4 实际签名，已通过 Grep 验证）：
 * 1. OrderService.create(ctx, userId?) 不接受 stockLocationCode/customFields
 * 2. addItemToOrder(ctx, orderId, variantId, qty, customFields?) 第 5 参设 OrderLine 字段
 * 3. addManualPaymentToOrder 必须在事务中；method 字段不校验 PaymentMethod 注册
 * 4. PaymentSettled 需手动 transitionToState；checkPaymentsCoverTotal 默认校验
 */
@Injectable()
export class PosOrderService {
  constructor(
    @InjectConnection() private connection: Connection,
    @Inject(TransactionalConnection) private transactionalConnection: TransactionalConnection,
    @Inject(OrderService) private orderService: OrderService,
    @Inject(StockMovementService) private stockMovementService: StockMovementService,
    @Inject(MemberPriceCalculator) private memberPriceCalculator: MemberPriceCalculator,
    @Inject(PromotionEngineService) private promotionEngine: PromotionEngineService,
  ) {}

  /**
   * 确保班次有活跃 Order。无则创建并绑定 custom fields + session.customer。
   */
  async ensureActiveOrder(ctx: RequestContext, session: PosSession): Promise<Order> {
    if (session.activeOrderId) {
      const existing = await this.orderService.findOne(ctx, session.activeOrderId);
      if (existing && existing.active) {
        // 取单/历史挂单可能缺少 orderKind（旧数据），补齐后再返回，
        // 否则 marketplace 订单流程会以 "not all lines have shipping" 阻断转入 ArrangingPayment。
        if ((existing.customFields as any)?.orderKind !== 'assistant') {
          await this.connection.getRepository(Order).update(existing.id, {
            customFields: { ...existing.customFields, orderKind: 'assistant' } as any,
          });
        }
        return existing;
      }
    }
    // 创建新 Order（create 不接受 customFields，需创建后 update）
    const order = await this.orderService.create(ctx);
    // 设置 Order custom fields + 绑定 session.customer（会员价引擎依赖 order.customer.customFields.memberLevel）
    // orderKind='assistant'：POS 单无配送行，marketplace 订单流程据此豁免 shippingLineId 校验（与公众号助手直付单同语义）
    await this.connection.getRepository(Order).update(order.id, {
      customFields: {
        posSessionId: session.id,
        orderType: 'sale',
        terminalCode: session.terminal.code,
        orderKind: 'assistant',
      } as any,
      ...(session.customerId
        ? { customer: { id: session.customerId } as any }
        : {}),
    });
    // 更新 session.activeOrderId
    await this.connection.getRepository(PosSession).update(session.id, {
      activeOrderId: Number(order.id),
    });
    session.activeOrderId = Number(order.id);
    return this.orderService.findOne(ctx, order.id) as Promise<Order>;
  }

  /**
   * 加商品到当前班次 Order。通过 addItemToOrder 第 5 参设置 OrderLine custom fields。
   * 若 session 绑定会员且匹配会员价规则：自动应用 discountPercent（未显式传 discount 时）。
   * 会员价实际生效：更新 OrderLine.listPrice = Math.floor(originalListPrice * discountPercent / 100)
   */
  async addPosItem(
    ctx: RequestContext,
    session: PosSession,
    input: {
      productVariantId: ID;
      quantity: number;
      discount?: number;
      isGift?: boolean;
      note?: string;
      originalPrice?: number;
    },
  ): Promise<Order> {
    const order = await this.ensureActiveOrder(ctx, session);

    // 显式 discount 优先（收银员手动改价）；未传时若 session 绑定会员，应用会员价规则
    let discount = input.discount;
    let memberPriceApplied = false;
    if (discount == null && session.customerId) {
      const customer = session.customer ?? ({ id: session.customerId } as Customer);
      const calc = await this.memberPriceCalculator.calculate(
        ctx,
        customer,
        Number(input.productVariantId),
      );
      discount = calc.discountPercent;
      memberPriceApplied = calc.applied;
    }
    const finalDiscount = discount ?? 100;

    // 记录加购前的 line id 集合，用于定位新加的 line
    const beforeLineIds = new Set(order.lines.map((l: any) => Number(l.id)));

    const result = await this.orderService.addItemToOrder(
      ctx,
      order.id,
      input.productVariantId,
      input.quantity,
      {
        originalPrice: input.originalPrice ?? 0,
        discount: finalDiscount,
        memberPriceApplied: memberPriceApplied || finalDiscount < 100,
        isGift: input.isGift ?? false,
        note: input.note ?? null,
      },
    );
    // addItemToOrder 返回 ErrorResultUnion，需检查是否出错
    if ('errorCode' in result) {
      throw new UserInputError(`加商品失败: ${result.message}`);
    }

    // 应用会员价/手动折扣到 listPrice（Vendure 的 listPrice 决定 unitPrice）
    if (finalDiscount < 100) {
      const reloaded = await this.orderService.findOne(ctx, order.id);
      if (reloaded) {
        // 找新加的 line（同 variant 的最新 line）；若已合并则取该 variant 的 line
        const targetLine = reloaded.lines.find(
          (l: any) =>
            !beforeLineIds.has(Number(l.id)) ||
            Number(l.productVariant.id) === Number(input.productVariantId),
        );
        if (targetLine) {
          const originalListPrice = targetLine.initialListPrice ?? targetLine.listPrice;
          const newListPrice = Math.floor((originalListPrice * finalDiscount) / 100);
          await this.connection.getRepository(OrderLine).update(Number(targetLine.id), {
            listPrice: newListPrice,
          });
        }
      }
    }

    // 促销引擎 reapply：基于当前 order + session.customer 重算最优（会员价 vs 促销规则互斥）
    // 传入 session.stockLocation.id 用于买赠库存校验
    const orderForReapply = (await this.orderService.findOne(ctx, order.id)) as Order;
    if (orderForReapply) {
      const customer = session.customer ?? (session.customerId ? ({ id: session.customerId } as Customer) : null);
      const stockLocationId = session.stockLocation ? Number(session.stockLocation.id) : null;
      return this.promotionEngine.reapply(ctx, { customer, stockLocationId }, orderForReapply);
    }

    return this.orderService.findOne(ctx, order.id) as Promise<Order>;
  }

  /**
   * 修改 OrderLine 数量。
   */
  async updatePosItem(
    ctx: RequestContext,
    session: PosSession,
    input: { orderLineId: ID; quantity: number },
  ): Promise<Order> {
    if (!session.activeOrderId) {
      throw new UserInputError('当前班次无活跃订单');
    }
    const result = await this.orderService.adjustOrderLine(
      ctx,
      session.activeOrderId,
      input.orderLineId,
      input.quantity,
    );
    if ('errorCode' in result) {
      throw new UserInputError(`修改商品失败: ${result.message}`);
    }
    return this.orderService.findOne(ctx, session.activeOrderId) as Promise<Order>;
  }

  /**
   * 结账：transitionToState ArrangingPayment → addManualPaymentToOrder → transitionToState PaymentSettled。
   * addManualPaymentToOrder 必须在事务中，整个结账流程用 withTransaction 包裹。
   */
  async checkoutPosOrder(
    ctx: RequestContext,
    session: PosSession,
    input: {
      payments: Array<{ method: string; transactionId?: string; metadata?: any }>;
    },
  ): Promise<{ order: Order; payments: any[] }> {
    const order = await this.ensureActiveOrder(ctx, session);
    if (order.lines.length === 0) {
      throw new UserInputError('购物车为空，无法结账');
    }

    const settledPayments: any[] = [];

    await this.transactionalConnection.withTransaction(ctx, async txCtx => {
      // 1. AddingItems → ArrangingPayment
      const arrangeResult = await this.orderService.transitionToState(
        txCtx,
        order.id,
        'ArrangingPayment',
      );
      if ('errorCode' in arrangeResult) {
        throw new UserInputError(`转入 ArrangingPayment 失败: ${arrangeResult.message}`);
      }

      // 2. 逐笔添加 manual payment（内部 Payment 直接 Created → Settled）
      //    defaultPaymentProcess.onTransitionEnd 会在 Payment 覆盖 total 时
      //    自动 transition order 到 PaymentSettled，无需手动调用。
      for (const pay of input.payments) {
        const payResult = await this.orderService.addManualPaymentToOrder(txCtx, {
          orderId: order.id,
          method: pay.method,
          transactionId: pay.transactionId,
          metadata: pay.metadata ?? {},
        });
        if ('errorCode' in payResult) {
          throw new UserInputError(`添加支付失败: ${payResult.message}`);
        }
      }

      // 3. 收集 Payment 快照并校验 order 已到 PaymentSettled
      const finalOrder = await this.orderService.findOne(txCtx, order.id, ['payments', 'lines']);
      if (finalOrder) {
        settledPayments.push(...(finalOrder.payments ?? []));
        if (finalOrder.state !== 'PaymentSettled') {
          throw new UserInputError(
            `结账未完成：订单状态为 ${finalOrder.state}，预期 PaymentSettled（支付金额可能不足）`,
          );
        }
        // 4. POS 无 Fulfillment 步骤，手动触发 SALE 扣减（stockOnHand--, stockAllocated--）
        //    Vendure 默认在 ArrangingPayment→PaymentSettled 时已执行 ALLOCATE（分配），
        //    但 SALE（实际扣减）只在 Fulfillment Shipped 时触发。POS 场景需手动补上。
        const orderLines = finalOrder.lines.map(line => ({
          orderLineId: line.id,
          quantity: line.quantity,
        }));
        await this.stockMovementService.createSalesForOrder(txCtx, orderLines);
      }
    });

    // 4. 清除 session.activeOrderId
    await this.connection.getRepository(PosSession).update(session.id, {
      activeOrderId: null,
    });
    session.activeOrderId = null;

    const finalOrder = await this.orderService.findOne(ctx, order.id, ['payments']);
    return { order: finalOrder as Order, payments: settledPayments };
  }

  /**
   * 离线订单同步入口：创建 Draft Order → 加商品 → 结账。
   * 不依赖 PosSession（离线订单可能没有对应的服务端班次），直接创建独立 Order。
   * 库存不足（addItemToOrder 抛 Insufficient stock）→ 抛 code='OUT_OF_STOCK' 错误。
   */
  async createOrderFromOffline(
    ctx: RequestContext,
    order: CreateOrderFromOfflineInput,
  ): Promise<Order> {
    // 1. 创建 Draft Order
    const newOrder = await this.orderService.create(ctx);
    await this.connection.getRepository(Order).update(newOrder.id, {
      customFields: {
        orderType: order.orderType,
        terminalCode: order.terminalCode,
        // 离线补单同为 POS 直付单，需豁免 marketplace 流程的 shippingLineId 校验
        orderKind: 'assistant',
      } as any,
    });

    // 2. 遍历 lines 加商品
    for (const line of order.lines) {
      const discount = line.discount ?? 100;
      const result = await this.orderService.addItemToOrder(
        ctx,
        newOrder.id,
        line.productVariantId,
        line.quantity,
        {
          originalPrice: line.originalPrice ?? 0,
          discount,
          memberPriceApplied: discount < 100,
          isGift: line.isGift ?? false,
          note: line.note ?? null,
        },
      );
      if ('errorCode' in result) {
        const err: Error & { code?: string } = new Error(result.message);
        if (result.errorCode === 'INSUFFICIENT_STOCK_ERROR') {
          err.code = 'OUT_OF_STOCK';
        }
        throw err;
      }
    }

    // 3. 结账：transitionToState ArrangingPayment → addManualPaymentToOrder（事务）
    await this.transactionalConnection.withTransaction(ctx, async txCtx => {
      const arrangeResult = await this.orderService.transitionToState(
        txCtx,
        newOrder.id,
        'ArrangingPayment',
      );
      if ('errorCode' in arrangeResult) {
        throw new Error(`转入 ArrangingPayment 失败: ${arrangeResult.message}`);
      }

      for (const pay of order.payments) {
        const payResult = await this.orderService.addManualPaymentToOrder(txCtx, {
          orderId: newOrder.id,
          method: pay.method,
          transactionId: pay.transactionId,
          metadata: pay.metadata ?? {},
        });
        if ('errorCode' in payResult) {
          throw new Error(`添加支付失败: ${payResult.message}`);
        }
      }
    });

    // 4. 手动触发 SALE 扣减（与 checkoutPosOrder 同理，POS 无 Fulfillment）
    const settledOrder = await this.orderService.findOne(ctx, newOrder.id, ['payments', 'lines']);
    if (settledOrder && settledOrder.state === 'PaymentSettled') {
      const orderLines = settledOrder.lines.map(line => ({
        orderLineId: line.id,
        quantity: line.quantity,
      }));
      await this.stockMovementService.createSalesForOrder(ctx, orderLines);
    }

    // 5. 返回最终 Order
    const finalOrder = await this.orderService.findOne(ctx, newOrder.id, ['payments']);
    return finalOrder as Order;
  }

  // ===== Phase 5: 退货与挂单 =====

  /**
   * 创建退货单：独立 orderType=refund 的 Order + 负数量 OrderLine 直插 + createCancellationsForOrderLines 回库。
   *
   * 关键约束：
   * 1. addItemToOrder 不接受负数量，需通过 OrderLine Repository 直插
   * 2. addManualPaymentToOrder 自动计算 amount = totalWithTax - totalCoveredBy，退货 total 为负 → Payment 负金额
   * 3. createCancellationsForOrderLines 不校验 orderLine.quantity 正负，基于 input.quantity(正数) 回库
   * 4. 原单必须 PaymentSettled，退货数量不超过原单已售数量（已退货数量需查关联 refund 单累加）
   */
  async createRefundOrder(
    ctx: RequestContext,
    session: PosSession,
    input: {
      originalOrderId: ID;
      refundLines: Array<{ orderLineId: ID; quantity: number; reason?: string }>;
    },
  ): Promise<{ refundOrder: Order; originalOrder: Order }> {
    // 1. 查原单
    const originalOrder = await this.orderService.findOne(ctx, input.originalOrderId, [
      'lines',
      'payments',
      'lines.productVariant',
    ]);
    if (!originalOrder) {
      throw new UserInputError(`原单 ${input.originalOrderId} 不存在`);
    }
    if (originalOrder.state !== 'PaymentSettled') {
      throw new UserInputError(`原单状态 ${originalOrder.state} 不允许退货，仅 PaymentSettled 可退货`);
    }
    if (originalOrder.customFields?.orderType === 'refund') {
      throw new UserInputError('退货单不允许再次退货');
    }

    // 2. 校验退货行与数量
    if (input.refundLines.length === 0) {
      throw new UserInputError('退货行不能为空');
    }
    for (const rl of input.refundLines) {
      if (rl.quantity <= 0) {
        throw new UserInputError('退货数量必须为正数');
      }
      const originalLine = originalOrder.lines.find(l => idsAreEqual(l.id, rl.orderLineId));
      if (!originalLine) {
        throw new UserInputError(`原单行 ${rl.orderLineId} 不存在`);
      }
      if (rl.quantity > originalLine.quantity) {
        throw new UserInputError(
          `退货数量 ${rl.quantity} 超过原单行数量 ${originalLine.quantity}`,
        );
      }
    }

    // 3. 查询该原单已退货数量（防止超退）
    const alreadyRefundedMap = await this.getAlreadyRefundedQuantities(
      ctx,
      Number(originalOrder.id),
    );
    for (const rl of input.refundLines) {
      const originalLine = originalOrder.lines.find(l => idsAreEqual(l.id, rl.orderLineId))!;
      const already = alreadyRefundedMap.get(Number(originalLine.id)) ?? 0;
      if (rl.quantity + already > originalLine.quantity) {
        throw new UserInputError(
          `原单行 ${originalLine.id} 累计退货 ${rl.quantity + already} 超过原售 ${originalLine.quantity}`,
        );
      }
    }

    // 4. 创建独立 refund Order
    const refundOrder = await this.orderService.create(ctx);
    await this.connection.getRepository(Order).update(refundOrder.id, {
      customFields: {
        posSessionId: session.id,
        orderType: 'refund',
        refundedOrderId: Number(originalOrder.id),
        terminalCode: session.terminal.code,
        // 退货单无配送行，同样需要豁免 marketplace 流程的 shippingLineId 校验
        orderKind: 'assistant',
      } as any,
    });

    // 5. 直插负数量 OrderLine（绕过 addItemToOrder 的正数量校验）
    const orderLineRepo = this.connection.getRepository(OrderLine);
    for (const rl of input.refundLines) {
      const originalLine = originalOrder.lines.find(l => idsAreEqual(l.id, rl.orderLineId))!;
      const newLine = new OrderLine({
        order: { id: refundOrder.id } as any,
        productVariant: originalLine.productVariant,
        productVariantId: originalLine.productVariantId,
        quantity: -rl.quantity,
        listPrice: originalLine.listPrice,
        listPriceIncludesTax: originalLine.listPriceIncludesTax,
        initialListPrice: originalLine.initialListPrice,
        adjustments: originalLine.adjustments ?? [],
        taxLines: originalLine.taxLines ?? [],
      });
      newLine.customFields = {
        originalPrice: originalLine.customFields?.originalPrice ?? 0,
        discount: originalLine.customFields?.discount ?? 100,
        memberPriceApplied: originalLine.customFields?.memberPriceApplied ?? false,
        isGift: originalLine.customFields?.isGift ?? false,
        note: rl.reason ?? originalLine.customFields?.note ?? null,
        originalOrderLineId: Number(originalLine.id),
      };
      await orderLineRepo.save(newLine);
    }

    // 6. 重算 Order 总额：直插 OrderLine 不触发 OrderCalculator，需手动累加
    //    line.proratedLinePrice/proratedLinePriceWithTax（负数量行 → 负数总额）。
    //    addManualPaymentToOrder 用 order.totalWithTax - totalCoveredBy 计算 payment.amount，
    //    subTotal/subTotalWithTax 未更新时 amount=0，导致退款金额为 0。
    const reloadedForCalc = await this.orderService.findOne(ctx, refundOrder.id, ['lines']);
    if (reloadedForCalc) {
      let subTotal = 0;
      let subTotalWithTax = 0;
      for (const line of reloadedForCalc.lines) {
        subTotal += line.proratedLinePrice;
        subTotalWithTax += line.proratedLinePriceWithTax;
      }
      await this.connection.getRepository(Order).update(refundOrder.id, {
        subTotal,
        subTotalWithTax,
      });
    }

    // 7. 事务: ArrangingPayment → addManualPaymentToOrder(cash, 负金额自动计算) → PaymentSettled
    await this.transactionalConnection.withTransaction(ctx, async txCtx => {
      const arrangeResult = await this.orderService.transitionToState(
        txCtx,
        refundOrder.id,
        'ArrangingPayment',
      );
      if ('errorCode' in arrangeResult) {
        throw new UserInputError(`退货单转入 ArrangingPayment 失败: ${arrangeResult.message}`);
      }

      const payResult = await this.orderService.addManualPaymentToOrder(txCtx, {
        orderId: refundOrder.id,
        method: 'cash',
        transactionId: `refund-${originalOrder.code ?? originalOrder.id}`,
        metadata: { refund: true, originalOrderId: originalOrder.id },
      });
      if ('errorCode' in payResult) {
        throw new UserInputError(`添加退款支付失败: ${payResult.message}`);
      }
    });

    // 8. 库存回库: createCancellationsForOrderLines 传入 refundOrder 的 lineId + 正数量
    const reloadedRefundOrder = await this.orderService.findOne(ctx, refundOrder.id, ['lines']);
    if (reloadedRefundOrder) {
      const cancellationInputs = reloadedRefundOrder.lines.map(line => ({
        orderLineId: line.id,
        quantity: Math.abs(line.quantity),
      }));
      await this.stockMovementService.createCancellationsForOrderLines(ctx, cancellationInputs);
    }

    const finalRefundOrder = await this.orderService.findOne(ctx, refundOrder.id, ['payments']);
    return { refundOrder: finalRefundOrder as Order, originalOrder };
  }

  /**
   * 查询某原单已累计被退货的数量（按 originalOrderLineId 聚合）。
   * 通过 refundedOrderId custom field 反查所有 refund 单及其 OrderLine，
   * 再用 OrderLine custom field originalOrderLineId 精确匹配原单行。
   */
  private async getAlreadyRefundedQuantities(
    ctx: RequestContext,
    originalOrderId: number,
  ): Promise<Map<number, number>> {
    const result = await this.connection.getRepository(Order).find({
      where: { customFields: { refundedOrderId: originalOrderId } },
      relations: ['lines'],
    });
    const map = new Map<number, number>();
    for (const refundOrder of result) {
      for (const line of refundOrder.lines) {
        const originalLineId = line.customFields?.originalOrderLineId;
        if (originalLineId != null) {
          const qty = Math.abs(line.quantity);
          map.set(originalLineId, (map.get(originalLineId) ?? 0) + qty);
        }
      }
    }
    return map;
  }

  /**
   * 挂单: 把当前活跃 Order 的 orderType 改为 hold，清空 session.activeOrderId。
   * 挂单后该 Order 仍为 Draft（active=true），可在挂单列表中按 orderType=hold 过滤显示。
   */
  async holdOrder(ctx: RequestContext, session: PosSession): Promise<Order> {
    if (!session.activeOrderId) {
      throw new UserInputError('当前班次无活跃订单，无法挂单');
    }
    const order = await this.orderService.findOne(ctx, session.activeOrderId);
    if (!order) {
      throw new UserInputError('活跃订单不存在');
    }
    if (order.lines.length === 0) {
      throw new UserInputError('空订单不允许挂单');
    }

    await this.connection.getRepository(Order).update(order.id, {
      customFields: {
        ...order.customFields,
        orderType: 'hold',
      },
    });

    await this.connection.getRepository(PosSession).update(session.id, {
      activeOrderId: null,
    });
    session.activeOrderId = null;

    const updated = await this.orderService.findOne(ctx, order.id);
    return updated as Order;
  }

  /**
   * 取单: 校验目标 Order 为 hold 状态 + 归属本终端 + 当前无活跃订单，
   * 然后把 orderType 改回 sale 并设为 session.activeOrderId。
   */
  async resumeOrder(
    ctx: RequestContext,
    session: PosSession,
    orderId: ID,
  ): Promise<Order> {
    const order = await this.orderService.findOne(ctx, orderId);
    if (!order) {
      throw new UserInputError(`订单 ${orderId} 不存在`);
    }
    if (!order.active) {
      throw new UserInputError('该订单已结账，不可取单');
    }
    if (order.customFields?.orderType !== 'hold') {
      throw new UserInputError('该订单不是挂单状态，不可取单');
    }

    // 归属校验: 订单关联 session 的 terminal 必须等于当前 session.terminal
    const originalSessionId = order.customFields?.posSessionId;
    if (originalSessionId) {
      const originalSession = await this.connection
        .getRepository(PosSession)
        .findOne({
          where: { id: originalSessionId },
          relations: ['terminal'],
        });
      if (!originalSession || originalSession.terminal.id !== session.terminal.id) {
        throw new UserInputError('跨终端取单被禁止');
      }
    }

    if (session.activeOrderId) {
      // 当前有活跃订单时，若为空订单（无 lines）则自动丢弃，允许取单；
      // posActiveOrder resolver 会 ensureActiveOrder 创建空 Order，
      // 导致挂单后任何 posActiveOrder 查询都会生成空活跃订单阻塞取单。
      const activeOrder = await this.orderService.findOne(ctx, session.activeOrderId, ['lines']);
      if (activeOrder && activeOrder.lines.length > 0) {
        throw new UserInputError('当前已有活跃订单，请先结账或挂单后再取单');
      }
      // 丢弃空订单：将其 active 置 false，并清空 session.activeOrderId
      if (activeOrder) {
        await this.connection.getRepository(Order).update(activeOrder.id, { active: false });
      }
      await this.connection.getRepository(PosSession).update(session.id, { activeOrderId: null });
      session.activeOrderId = null;
    }

    await this.connection.getRepository(Order).update(order.id, {
      customFields: {
        ...order.customFields,
        orderType: 'sale',
        posSessionId: session.id,
        // 旧挂单可能没有 orderKind，取单时补齐
        orderKind: 'assistant',
      } as any,
    });
    await this.connection.getRepository(PosSession).update(session.id, {
      activeOrderId: Number(order.id),
    });
    session.activeOrderId = Number(order.id);

    const updated = await this.orderService.findOne(ctx, order.id);
    return updated as Order;
  }

  /**
   * 挂单列表: 当前 session.terminal 下所有 orderType=hold 的 Draft Order。
   * 按 updatedAt 倒序。
   */
  async findHeldOrders(ctx: RequestContext, session: PosSession): Promise<Order[]> {
    // 用 TypeORM repository find 而非 QueryBuilder 原生 SQL：customFields JSON 列在
    // sqljs/SQLite 下实际列名由 TypeORM 映射，原生 SQL `ord.customFields->>'key'` 报
    // "no such column"。find 方法的 customFields 嵌套过滤由 TypeORM 自动生成 json_extract。
    const orders = await this.connection.getRepository(Order).find({
      where: {
        active: true,
        customFields: {
          orderType: 'hold',
          terminalCode: session.terminal.code,
        },
      },
      order: { updatedAt: 'DESC' },
    });
    return orders;
  }

  /**
   * 按订单号查询原单（退货场景入口）。
   * 用 Vendure OrderService.findAll + filter code 精确匹配，返回带 lines/payments 的完整 Order。
   */
  async findByCode(ctx: RequestContext, code: string): Promise<Order | null> {
    const result = await this.orderService.findAll(ctx, {
      filter: { code: { eq: code } },
      take: 1,
    });
    if (result.items.length === 0) return null;
    const orderId = result.items[0].id;
    return this.orderService.findOne(ctx, orderId, ['lines', 'payments', 'lines.productVariant']) as Promise<Order>;
  }
}
