import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import {
  Customer,
  ID,
  Order,
  OrderLine,
  OrderService,
  ProductVariant,
  RequestContext,
  StockLevelService,
  TransactionalConnection,
  UserInputError,
} from '@vendure/core';
import { Connection } from 'typeorm';

import { PromotionRule } from '../entities/promotion-rule.entity';
import { PromotionRuleService } from './promotion-rule.service';

/**
 * 候选方案：会员价或某条促销规则。
 * - saving: 该方案给顾客省下的金额（分），用于排序选最优
 * - payload: 应用时需要的额外数据（如满减 tier、买赠 gift 价格），由 apply 使用
 */
export interface PromotionCandidate {
  ruleId: number | null; // null 表示会员价方案
  type: 'memberPrice' | 'fullReduction' | 'discount' | 'buyGift';
  saving: number;
  priority: number; // 来自规则 priority（会员价方案 priority=0，永远低于任何规则）
  payload?: any;
}

/**
 * 促销引擎：枚举候选 → 选最优 → 应用。
 * 互斥原则：会员价与所有促销规则两两互斥，取 saving 最大者；saving 相同 priority 大者优先。
 */
@Injectable()
export class PromotionEngineService {
  constructor(
    @InjectConnection() private connection: Connection,
    @Inject(TransactionalConnection) private transactionalConnection: TransactionalConnection,
    @Inject(PromotionRuleService) private ruleService: PromotionRuleService,
    @Inject(OrderService) private orderService: OrderService,
    @Inject(StockLevelService) private stockLevelService: StockLevelService,
  ) {}

  /**
   * 枚举所有候选方案（会员价 + active 规则），返回最优。
   * 若所有候选 saving ≤ 0 返回 null。
   * stockLocationId：用于买赠库存校验；为 null 时跳过库存校验（向后兼容）
   */
  async calculateBest(
    ctx: RequestContext,
    order: Order,
    member: { id: number; customFields?: any } | null,
    stockLocationId: number | null = null,
  ): Promise<PromotionCandidate | null> {
    const candidates: PromotionCandidate[] = [];

    // 1. 会员价候选
    const memberCandidate = await this.calculateMemberCandidate(order, member);
    if (memberCandidate && memberCandidate.saving > 0) {
      candidates.push(memberCandidate);
    }

    // 2. 促销规则候选
    const rules = await this.ruleService.findActiveRules(ctx);
    for (const rule of rules) {
      const candidate = await this.calculateRuleCandidate(ctx, rule, order, stockLocationId);
      if (candidate && candidate.saving > 0) {
        candidates.push(candidate);
      }
    }

    if (candidates.length === 0) return null;

    // 3. 排序：saving DESC → priority DESC → ruleId ASC（确定性）
    candidates.sort((a, b) => {
      if (b.saving !== a.saving) return b.saving - a.saving;
      if (b.priority !== a.priority) return b.priority - a.priority;
      // 会员价（ruleId=null）排在规则之后
      const aId = a.ruleId ?? Number.MAX_SAFE_INTEGER;
      const bId = b.ruleId ?? Number.MAX_SAFE_INTEGER;
      return aId - bId;
    });

    return candidates[0];
  }

  /**
   * 会员价候选：saving = sum over memberPriceApplied lines: (initialListPrice - listPrice) * quantity
   */
  private async calculateMemberCandidate(
    order: Order,
    member: { id: number; customFields?: any } | null,
  ): Promise<PromotionCandidate | null> {
    if (!member) return null;
    let saving = 0;
    for (const line of order.lines) {
      const cf = (line as any).customFields ?? {};
      if (!cf.memberPriceApplied) continue;
      const initial = (line as any).initialListPrice ?? line.unitPriceWithTax ?? 0;
      const current = line.listPrice ?? 0;
      saving += (initial - current) * line.quantity;
    }
    if (saving <= 0) return null;
    return {
      ruleId: null,
      type: 'memberPrice',
      saving,
      priority: 0, // 会员价 priority 固定 0，低于任何 active 规则
    };
  }

  private async calculateRuleCandidate(
    ctx: RequestContext,
    rule: PromotionRule,
    order: Order,
    stockLocationId: number | null,
  ): Promise<PromotionCandidate | null> {
    if (rule.type === 'fullReduction') {
      return this.calculateFullReductionCandidate(rule, order);
    }
    if (rule.type === 'discount') {
      return this.calculateDiscountCandidate(rule, order);
    }
    if (rule.type === 'buyGift') {
      return this.calculateBuyGiftCandidate(ctx, rule, order, stockLocationId);
    }
    return null;
  }

  /**
   * 满减：在 order.subTotal 上找最高满足的 tier，saving = reduction
   */
  private calculateFullReductionCandidate(
    rule: PromotionRule,
    order: Order,
  ): PromotionCandidate | null {
    const tiers = rule.conditions?.tiers ?? [];
    if (tiers.length === 0) return null;
    // 排除 gift 行后的 subTotal
    const subTotal = this.computeEffectiveSubTotal(order);
    let hitTier: { threshold: number; reduction: number } | null = null;
    for (const t of tiers) {
      if (subTotal >= t.threshold) {
        if (!hitTier || t.threshold > hitTier.threshold) {
          hitTier = t;
        }
      }
    }
    if (!hitTier) return null;
    return {
      ruleId: rule.id,
      type: 'fullReduction',
      saving: hitTier.reduction,
      priority: rule.priority,
      payload: { tier: hitTier },
    };
  }

  /**
   * 整单折扣：若 subTotal < minOrderValue 返回 null；saving = floor(subTotal * (100 - dp) / 100)
   */
  private calculateDiscountCandidate(
    rule: PromotionRule,
    order: Order,
  ): PromotionCandidate | null {
    const dp = rule.actions?.discountPercent;
    if (typeof dp !== 'number' || dp < 1 || dp > 100) return null;
    const subTotal = this.computeEffectiveSubTotal(order);
    const minOrderValue = rule.conditions?.minOrderValue ?? 0;
    if (subTotal < minOrderValue) return null;
    const saving = Math.floor((subTotal * (100 - dp)) / 100);
    if (saving <= 0) return null;
    return {
      ruleId: rule.id,
      type: 'discount',
      saving,
      priority: rule.priority,
    };
  }

  /**
   * 买赠：检查 order 是否命中 buyVariantId × buyQuantity；命中则 saving = giftVariant.price × giftQuantity
   * 库存校验：stockLocationId 非空时，检查 giftVariant 在该库存点的可用库存（stockOnHand - stockAllocated）≥ giftQuantity
   */
  private async calculateBuyGiftCandidate(
    ctx: RequestContext,
    rule: PromotionRule,
    order: Order,
    stockLocationId: number | null,
  ): Promise<PromotionCandidate | null> {
    const buyVariantId = rule.conditions?.buyVariantId;
    const buyQuantity = rule.conditions?.buyQuantity;
    const giftVariantId = rule.actions?.giftVariantId;
    const giftQuantity = rule.actions?.giftQuantity;
    if (
      typeof buyVariantId !== 'number' ||
      typeof buyQuantity !== 'number' ||
      typeof giftVariantId !== 'number' ||
      typeof giftQuantity !== 'number'
    ) {
      return null;
    }
    // 命中判定：order 中非 gift 行该 variant 累计数量 ≥ buyQuantity
    // productVariant.id 是 Vendure ID 格式（'T_1'），需用 parseId 解析后比较
    const matchedQty = order.lines
      .filter((l) => !((l as any).customFields?.isGift))
      .filter((l) => this.parseId(l.productVariant.id) === buyVariantId)
      .reduce((sum, l) => sum + l.quantity, 0);
    if (matchedQty < buyQuantity) return null;

    // 库存校验：giftVariant 在 stockLocationId 的可用库存 ≥ giftQuantity
    // 可用库存 = stockOnHand - stockAllocated（已分配未发货的库存）
    // 注意：gift 行加入订单时会触发 allocation（stockAllocated++），所以校验的是"扣除已分配后的剩余"
    if (stockLocationId != null) {
      const stockLevel = await this.stockLevelService.getStockLevel(
        ctx,
        giftVariantId as ID,
        stockLocationId as ID,
      );
      const available = stockLevel.stockOnHand - stockLevel.stockAllocated;
      if (available < giftQuantity) {
        // 库存不足，候选失败（不抛错，静默跳过，让其他候选可能胜出）
        return null;
      }
    }

    // 查 gift variant 当前 channel 的 price
    // 注意：ProductVariant.price 是 @Calculated 字段，依赖 listPrice（运行时计算）
    // 直接 findOne 时 listPrice 未设置，price 返回 0；需查 productVariantPrices 关联取真实价格
    const giftVariant = await this.connection
      .getRepository(ProductVariant)
      .findOne({
        where: { id: giftVariantId },
        relations: ['productVariantPrices'],
      });
    if (!giftVariant) return null;
    const priceForChannel = (giftVariant as any).productVariantPrices?.find(
      (p: any) => Number(p.channelId) === Number(ctx.channelId),
    );
    const giftPrice = priceForChannel?.price ?? 0;
    const saving = giftPrice * giftQuantity;
    if (saving <= 0) return null;
    return {
      ruleId: rule.id,
      type: 'buyGift',
      saving,
      priority: rule.priority,
      payload: { giftVariantId, giftQuantity, giftPrice },
    };
  }

  /**
   * 计算有效 subTotal（原价基准）：排除 isGift 行，用 initialListPrice 而非 listPrice
   * 因为 listPrice 可能已被会员价修改，互斥对比必须基于原价才公平
   */
  private computeEffectiveSubTotal(order: Order): number {
    return order.lines
      .filter((l) => !((l as any).customFields?.isGift))
      .reduce(
        (sum, l) => sum + ((l as any).initialListPrice ?? l.listPrice ?? 0) * l.quantity,
        0,
      );
  }

  /**
   * 解析 Vendure ID（'T_1' → 1）
   */
  private parseId(id: any): number {
    const s = String(id ?? '');
    const parts = s.split('_');
    const num = parseInt(parts[parts.length - 1] ?? '0', 10);
    return Number.isFinite(num) ? num : 0;
  }

  /**
   * 撤销订单中所有 memberPriceApplied=true 行的 listPrice 到 initialListPrice。
   * 用于 winning 是促销规则（非会员价）时，确保顾客只享受促销优惠（互斥）。
   * 注意：仅恢复 listPrice，不重置 memberPriceApplied 标志（不影响 saving 计算，因 saving = initial - listPrice = 0）
   */
  private async revertMemberPriceLines(order: Order): Promise<void> {
    for (const line of order.lines) {
      const cf = (line as any).customFields ?? {};
      if (cf.memberPriceApplied) {
        const initial = (line as any).initialListPrice ?? line.listPrice ?? 0;
        if (line.listPrice !== initial) {
          await this.connection.getRepository(OrderLine).update(Number(line.id), {
            listPrice: initial,
          });
        }
      }
    }
  }

  // ===== 应用层 =====

  /**
   * 重新应用促销：清理旧促销 → 计算 winning → 应用。
   * 返回更新后的 order。
   * customer 参数：可传 Customer 实体或轻量 { id } 对象，统一转 { id: number, customFields? }
   * stockLocationId：班次库存点 ID，用于买赠库存校验；null 时跳过校验
   */
  async reapply(
    ctx: RequestContext,
    session: { customer: any | null; stockLocationId?: number | null },
    order: Order,
  ): Promise<Order> {
    // 1. 清理旧促销（gift line + order customFields）
    await this.clearPreviousPromotion(ctx, order);

    // 2. 计算最优
    const rawCustomer = session.customer;
    const member = rawCustomer
      ? { id: Number(rawCustomer.id), customFields: (rawCustomer as any).customFields }
      : null;
    // 重新加载 order（clearPrevious 可能修改了 lines）
    const orderForCalc = (await this.orderService.findOne(ctx, order.id)) as Order;
    if (!orderForCalc) return order;
    const best = await this.calculateBest(ctx, orderForCalc, member, session.stockLocationId ?? null);

    // 3. 应用
    if (!best) {
      return orderForCalc;
    }

    if (best.type === 'memberPrice') {
      await this.applyMember(ctx, orderForCalc);
    } else {
      // winning 是促销规则（非会员价）：先 revert 会员价行 listPrice 到原价，确保互斥
      // （addPosItem 阶段可能已应用会员价修改 listPrice，需恢复以避免叠加优惠）
      await this.revertMemberPriceLines(orderForCalc);
      if (best.type === 'fullReduction') {
        const rule = await this.ruleService.findOne(ctx, best.ruleId!);
        if (rule) await this.applyFullReduction(ctx, orderForCalc, rule, best.payload.tier);
      } else if (best.type === 'discount') {
        const rule = await this.ruleService.findOne(ctx, best.ruleId!);
        if (rule) await this.applyDiscount(ctx, orderForCalc, rule);
      } else if (best.type === 'buyGift') {
        const rule = await this.ruleService.findOne(ctx, best.ruleId!);
        if (rule) await this.applyBuyGift(ctx, orderForCalc, rule);
      }
    }

    return (await this.orderService.findOne(ctx, order.id)) as Order;
  }

  /**
   * 清理旧促销：
   * 1. 删除所有 giftRuleId != null 的 OrderLine（buyGift 加的赠品行）
   * 2. 重置 order.customFields.promotionId/Type/Discount 为 null
   */
  private async clearPreviousPromotion(ctx: RequestContext, order: Order): Promise<void> {
    const giftLines = order.lines.filter((l) => {
      const cf = (l as any).customFields ?? {};
      return cf.giftRuleId != null || cf.isGift === true;
    });
    for (const line of giftLines) {
      try {
        await this.orderService.removeItemFromOrder(ctx, order.id, line.id);
      } catch {
        // 行可能已被其他流程删除，忽略
      }
    }
    await this.connection.getRepository(Order).update(order.id, {
      customFields: {
        ...((order as any).customFields ?? {}),
        promotionId: null,
        promotionType: null,
        promotionDiscount: null,
      },
    } as any);
  }

  private async applyMember(ctx: RequestContext, order: Order): Promise<void> {
    // 会员价已应用到 line.listPrice（addPosItem 时），此处仅标注 order.customFields
    await this.updateOrderPromotionFields(order, {
      promotionId: null,
      promotionType: 'memberPrice',
      promotionDiscount: null,
    });
  }

  private async applyFullReduction(
    ctx: RequestContext,
    order: Order,
    rule: PromotionRule,
    tier: { threshold: number; reduction: number },
  ): Promise<void> {
    await this.updateOrderPromotionFields(order, {
      promotionId: rule.id,
      promotionType: 'fullReduction',
      promotionDiscount: tier.reduction,
    });
  }

  private async applyDiscount(
    ctx: RequestContext,
    order: Order,
    rule: PromotionRule,
  ): Promise<void> {
    const dp = rule.actions?.discountPercent ?? 100;
    const subTotal = this.computeEffectiveSubTotal(order);
    const discount = Math.floor((subTotal * (100 - dp)) / 100);
    await this.updateOrderPromotionFields(order, {
      promotionId: rule.id,
      promotionType: 'discount',
      promotionDiscount: discount,
    });
  }

  private async applyBuyGift(
    ctx: RequestContext,
    order: Order,
    rule: PromotionRule,
  ): Promise<void> {
    const giftVariantId = rule.actions?.giftVariantId;
    const giftQuantity = rule.actions?.giftQuantity;
    if (typeof giftVariantId !== 'number' || typeof giftQuantity !== 'number') return;

    // 加 gift 行：customFields.isGift=true, originalPrice=0, discount=100, note=`买赠:${rule.name}`, giftRuleId=rule.id
    const result = await this.orderService.addItemToOrder(
      ctx,
      order.id,
      giftVariantId as ID,
      giftQuantity,
      {
        originalPrice: 0,
        discount: 100,
        memberPriceApplied: false,
        isGift: true,
        note: `买赠:${rule.name}`,
        giftRuleId: rule.id,
      } as any,
    );
    if ('errorCode' in result) {
      throw new UserInputError(`加赠品行失败: ${(result as any).message}`);
    }

    // gift 行 listPrice 置 0（addItemToOrder 会按 variant.price 设置，需覆盖）
    const reloaded = await this.orderService.findOne(ctx, order.id);
    if (reloaded) {
      const giftLine = reloaded.lines.find(
        (l) => (l as any).customFields?.giftRuleId === rule.id,
      );
      if (giftLine) {
        await this.connection.getRepository(OrderLine).update(Number(giftLine.id), {
          listPrice: 0,
        } as any);
      }
    }

    await this.updateOrderPromotionFields(order, {
      promotionId: rule.id,
      promotionType: 'buyGift',
      promotionDiscount: 0, // 买赠优惠体现在 gift 行 listPrice=0，order 级 discount 标 0
    });
  }

  private async updateOrderPromotionFields(
    order: Order,
    fields: { promotionId: number | null; promotionType: string | null; promotionDiscount: number | null },
  ): Promise<void> {
    const existingCf = (order as any).customFields ?? {};
    await this.connection.getRepository(Order).update(order.id, {
      customFields: {
        ...existingCf,
        promotionId: fields.promotionId,
        promotionType: fields.promotionType,
        promotionDiscount: fields.promotionDiscount,
      },
    } as any);
  }
}
