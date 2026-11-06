import { ID, Order, OrderService, RequestContext } from '@vendure/core';
import { PromotionRule } from '../entities/promotion-rule.entity';
import { PosSessionService } from '../services/pos-session.service';
import { PromotionEngineService } from '../services/promotion-engine.service';
import { PromotionRuleService } from '../services/promotion-rule.service';
import { PromotionRuleInput } from '../services/promotion-rule.service';
/**
 * 促销规则管理 + 手动 reapply 入口。
 * 权限：CRUD 用 Settings 权限 + posSessionPermission；reapplyPromotion 用 posSessionPermission.Update
 */
export declare class AdminPromotionResolver {
    private ruleService;
    private sessionService;
    private orderService;
    private promotionEngine;
    constructor(ruleService: PromotionRuleService, sessionService: PosSessionService, orderService: OrderService, promotionEngine: PromotionEngineService);
    promotionRules(ctx: RequestContext, channelId?: string): Promise<PromotionRule[]>;
    promotionRule(ctx: RequestContext, id: string): Promise<PromotionRule | null>;
    createPromotionRule(ctx: RequestContext, input: PromotionRuleInput): Promise<PromotionRule>;
    updatePromotionRule(ctx: RequestContext, input: any): Promise<PromotionRule>;
    deletePromotionRule(ctx: RequestContext, id: string): Promise<boolean>;
    /**
     * 手动触发重新应用促销（管理员调试用）。
     * 通常 addPosItem 会自动 reapply，此接口便于规则变更后对存量订单重算。
     * 注意：手动 reapply 时 member 上下文从 order.customer 推断（无 session 时）。
     */
    reapplyPromotion(ctx: RequestContext, orderId: ID): Promise<Order>;
}
