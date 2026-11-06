import { RequestContext } from '@vendure/core';
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
export declare class PromotionRuleService {
    private connection;
    constructor(connection: Connection);
    /**
     * 解析并校验渠道：只允许操作当前请求渠道的数据。
     * 显式传了其他渠道 id 时直接拒绝，避免跨租户读取/改写。
     */
    private assertChannel;
    findAll(ctx: RequestContext, channelId?: number): Promise<PromotionRule[]>;
    /**
     * 按 id + 渠道查询。跨渠道 id 返回 null（调用方据此拒绝 update/delete）。
     */
    findOne(ctx: RequestContext, id: number): Promise<PromotionRule | null>;
    /**
     * 返回当前时段有效的规则（active=true 且 currentTime 在 [startTime, endTime] 内）。
     * 按 priority DESC 排序。
     */
    findActiveRules(ctx: RequestContext): Promise<PromotionRule[]>;
    create(ctx: RequestContext, input: PromotionRuleInput): Promise<PromotionRule>;
    update(ctx: RequestContext, id: number, input: Partial<PromotionRuleInput>): Promise<PromotionRule>;
    delete(ctx: RequestContext, id: number): Promise<boolean>;
    /**
     * type-specific 校验：conditions/actions 必须与 type 匹配。
     * - fullReduction: conditions.tiers 必须非空且 threshold 递增；actions 可为 null
     * - discount: actions.discountPercent ∈ [1,100]；conditions.minOrderValue 可选 ≥ 0
     * - buyGift: conditions.buyVariantId/buyQuantity > 0；actions.giftVariantId/giftQuantity > 0
     */
    private validateInput;
}
