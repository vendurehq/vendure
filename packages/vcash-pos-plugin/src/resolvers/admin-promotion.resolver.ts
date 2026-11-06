import { Inject } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  Allow,
  Ctx,
  ID,
  Order,
  OrderService,
  Permission,
  RequestContext,
  UserInputError,
} from '@vendure/core';

import { posSessionPermission } from '../constants';
import { PromotionRule } from '../entities/promotion-rule.entity';
import { PosSessionService } from '../services/pos-session.service';
import { PromotionEngineService } from '../services/promotion-engine.service';
import { PromotionRuleService } from '../services/promotion-rule.service';
import { PromotionRuleInput } from '../services/promotion-rule.service';

/**
 * 促销规则管理 + 手动 reapply 入口。
 * 权限：CRUD 用 Settings 权限 + posSessionPermission；reapplyPromotion 用 posSessionPermission.Update
 */
@Resolver()
export class AdminPromotionResolver {
  constructor(
    @Inject(PromotionRuleService) private ruleService: PromotionRuleService,
    @Inject(PosSessionService) private sessionService: PosSessionService,
    @Inject(OrderService) private orderService: OrderService,
    @Inject(PromotionEngineService) private promotionEngine: PromotionEngineService,
  ) {}

  @Query()
  @Allow(Permission.ReadSettings, posSessionPermission.Read)
  async promotionRules(
    @Ctx() ctx: RequestContext,
    @Args('channelId', { nullable: true }) channelId?: string,
  ): Promise<PromotionRule[]> {
    return this.ruleService.findAll(ctx, channelId ? parseInt(channelId, 10) : undefined);
  }

  @Query()
  @Allow(Permission.ReadSettings, posSessionPermission.Read)
  async promotionRule(
    @Ctx() ctx: RequestContext,
    @Args('id') id: string,
  ): Promise<PromotionRule | null> {
    return this.ruleService.findOne(ctx, parseInt(id, 10));
  }

  @Mutation()
  @Allow(Permission.CreateSettings, posSessionPermission.Create)
  async createPromotionRule(
    @Ctx() ctx: RequestContext,
    @Args('input') input: PromotionRuleInput,
  ): Promise<PromotionRule> {
    return this.ruleService.create(ctx, input);
  }

  @Mutation()
  @Allow(Permission.UpdateSettings, posSessionPermission.Update)
  async updatePromotionRule(
    @Ctx() ctx: RequestContext,
    @Args('input') input: any,
  ): Promise<PromotionRule> {
    return this.ruleService.update(ctx, parseInt(input.id, 10), input);
  }

  @Mutation()
  @Allow(Permission.DeleteSettings, posSessionPermission.Delete)
  async deletePromotionRule(
    @Ctx() ctx: RequestContext,
    @Args('id') id: string,
  ): Promise<boolean> {
    return this.ruleService.delete(ctx, parseInt(id, 10));
  }

  /**
   * 手动触发重新应用促销（管理员调试用）。
   * 通常 addPosItem 会自动 reapply，此接口便于规则变更后对存量订单重算。
   * 注意：手动 reapply 时 member 上下文从 order.customer 推断（无 session 时）。
   */
  @Mutation()
  @Allow(posSessionPermission.Update)
  async reapplyPromotion(
    @Ctx() ctx: RequestContext,
    @Args('orderId') orderId: ID,
  ): Promise<Order> {
    const order = await this.orderService.findOne(ctx, orderId);
    if (!order) throw new UserInputError(`订单 ${orderId} 不存在`);
    // 手动 reapply：member 从 order.customer 推断（已结账订单可能无 session，但 order.customer 保留）
    return this.promotionEngine.reapply(ctx, { customer: (order as any).customer ?? null }, order);
  }
}
