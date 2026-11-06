import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { RequestContext, UserInputError } from '@vendure/core';
import { Connection } from 'typeorm';

import { PromotionRule, PromotionType } from '../entities/promotion-rule.entity';

export interface PromotionRuleInput {
  type: PromotionType;
  name: string;
  description?: string | null;
  scope?: 'global' | 'collection';
  collectionId?: number | null;
  priority?: number;
  active?: boolean;
  startTime?: Date | null;
  endTime?: Date | null;
  conditions?: any;
  actions?: any;
}

/**
 * 促销规则服务：CRUD + findActiveRules。
 * 校验：conditions/actions 必须与 type 匹配（type-specific validation）。
 */
@Injectable()
export class PromotionRuleService {
  constructor(@InjectConnection() private connection: Connection) {}

  /**
   * 解析并校验渠道：只允许操作当前请求渠道的数据。
   * 显式传了其他渠道 id 时直接拒绝，避免跨租户读取/改写。
   */
  private assertChannel(ctx: RequestContext, channelId?: number | null): number {
    const current = Number(ctx.channelId);
    if (!Number.isFinite(current)) {
      throw new UserInputError('当前请求未绑定渠道');
    }
    if (channelId != null && Number(channelId) !== current) {
      throw new UserInputError('无权访问其他渠道的促销规则');
    }
    return current;
  }

  async findAll(ctx: RequestContext, channelId?: number): Promise<PromotionRule[]> {
    const targetChannelId = this.assertChannel(ctx, channelId);
    return this.connection
      .getRepository(PromotionRule)
      .createQueryBuilder('rule')
      .where('rule.channelId = :channelId', { channelId: targetChannelId })
      .orderBy('rule.priority', 'DESC')
      .addOrderBy('rule.id', 'ASC')
      .getMany();
  }

  /**
   * 按 id + 渠道查询。跨渠道 id 返回 null（调用方据此拒绝 update/delete）。
   */
  async findOne(ctx: RequestContext, id: number): Promise<PromotionRule | null> {
    const channelId = this.assertChannel(ctx);
    return this.connection
      .getRepository(PromotionRule)
      .findOne({ where: { id, channelId } });
  }

  /**
   * 返回当前时段有效的规则（active=true 且 currentTime 在 [startTime, endTime] 内）。
   * 按 priority DESC 排序。
   */
  async findActiveRules(ctx: RequestContext): Promise<PromotionRule[]> {
    const now = new Date();
    const qb = this.connection
      .getRepository(PromotionRule)
      .createQueryBuilder('rule')
      .where('rule.channelId = :channelId', { channelId: ctx.channelId as number })
      .andWhere('rule.active = :active', { active: true })
      .andWhere('(rule.startTime IS NULL OR rule.startTime <= :now)', { now })
      .andWhere('(rule.endTime IS NULL OR rule.endTime >= :now)', { now })
      .orderBy('rule.priority', 'DESC')
      .addOrderBy('rule.id', 'ASC');
    return qb.getMany();
  }

  async create(ctx: RequestContext, input: PromotionRuleInput): Promise<PromotionRule> {
    this.validateInput(input);
    const rule = new PromotionRule();
    rule.channelId = ctx.channelId as number;
    rule.type = input.type;
    rule.name = input.name;
    rule.description = input.description ?? null;
    rule.scope = input.scope ?? 'global';
    rule.collectionId = input.scope === 'collection' ? (input.collectionId ?? null) : null;
    rule.priority = input.priority ?? 10;
    rule.active = input.active ?? true;
    rule.startTime = input.startTime ?? null;
    rule.endTime = input.endTime ?? null;
    rule.conditions = input.conditions ?? null;
    rule.actions = input.actions ?? null;
    return this.connection.getRepository(PromotionRule).save(rule);
  }

  async update(
    ctx: RequestContext,
    id: number,
    input: Partial<PromotionRuleInput>,
  ): Promise<PromotionRule> {
    const rule = await this.findOne(ctx, id);
    if (!rule) throw new UserInputError(`促销规则 ${id} 不存在`);
    if (input.type !== undefined) rule.type = input.type;
    if (input.name !== undefined) rule.name = input.name;
    if (input.description !== undefined) rule.description = input.description ?? null;
    if (input.scope !== undefined) rule.scope = input.scope;
    if (input.collectionId !== undefined) rule.collectionId = input.collectionId ?? null;
    if (input.priority !== undefined) rule.priority = input.priority;
    if (input.active !== undefined) rule.active = input.active;
    if (input.startTime !== undefined) rule.startTime = input.startTime ?? null;
    if (input.endTime !== undefined) rule.endTime = input.endTime ?? null;
    if (input.conditions !== undefined) rule.conditions = input.conditions ?? null;
    if (input.actions !== undefined) rule.actions = input.actions ?? null;
    this.validateInput(rule);
    return this.connection.getRepository(PromotionRule).save(rule);
  }

  async delete(ctx: RequestContext, id: number): Promise<boolean> {
    const channelId = this.assertChannel(ctx);
    const res = await this.connection
      .getRepository(PromotionRule)
      .delete({ id, channelId });
    if ((res.affected ?? 0) === 0) {
      throw new UserInputError(`促销规则 ${id} 不存在或不属于当前渠道`);
    }
    return true;
  }

  /**
   * type-specific 校验：conditions/actions 必须与 type 匹配。
   * - fullReduction: conditions.tiers 必须非空且 threshold 递增；actions 可为 null
   * - discount: actions.discountPercent ∈ [1,100]；conditions.minOrderValue 可选 ≥ 0
   * - buyGift: conditions.buyVariantId/buyQuantity > 0；actions.giftVariantId/giftQuantity > 0
   */
  private validateInput(input: PromotionRuleInput | PromotionRule): void {
    const type = input.type;
    const conditions = input.conditions;
    const actions = input.actions;

    if (!input.name || input.name.trim() === '') {
      throw new UserInputError('name 不能为空');
    }

    if (type === 'fullReduction') {
      const tiers = conditions?.tiers;
      if (!Array.isArray(tiers) || tiers.length === 0) {
        throw new UserInputError('fullReduction.conditions.tiers 必须为非空数组');
      }
      for (const t of tiers) {
        if (
          typeof t.threshold !== 'number' ||
          typeof t.reduction !== 'number' ||
          t.threshold < 0 ||
          t.reduction < 0 ||
          t.reduction > t.threshold
        ) {
          throw new UserInputError('tier.threshold/reduction 必须为非负数且 reduction ≤ threshold');
        }
      }
      // 阶梯必须按 threshold 递增
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].threshold <= tiers[i - 1].threshold) {
          throw new UserInputError('tiers.threshold 必须严格递增');
        }
      }
    } else if (type === 'discount') {
      const dp = actions?.discountPercent;
      if (typeof dp !== 'number' || dp < 1 || dp > 100) {
        throw new UserInputError('discount.actions.discountPercent 必须为 1-100');
      }
      if (conditions?.minOrderValue != null && typeof conditions.minOrderValue !== 'number') {
        throw new UserInputError('discount.conditions.minOrderValue 必须为数字');
      }
    } else if (type === 'buyGift') {
      if (
        typeof conditions?.buyVariantId !== 'number' ||
        typeof conditions?.buyQuantity !== 'number' ||
        conditions.buyQuantity < 1
      ) {
        throw new UserInputError('buyGift.conditions.buyVariantId/buyQuantity 必须为正数');
      }
      if (
        typeof actions?.giftVariantId !== 'number' ||
        typeof actions?.giftQuantity !== 'number' ||
        actions.giftQuantity < 1
      ) {
        throw new UserInputError('buyGift.actions.giftVariantId/giftQuantity 必须为正数');
      }
    } else {
      throw new UserInputError(`不支持的促销类型: ${type}`);
    }

    if (input.scope === 'collection' && !input.collectionId) {
      throw new UserInputError('scope=collection 时必须提供 collectionId');
    }
  }
}
