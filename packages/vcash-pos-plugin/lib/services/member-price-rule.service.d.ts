import { RequestContext } from '@vendure/core';
import { Connection } from 'typeorm';
import { MemberPriceRule, MemberPriceRuleScope } from '../entities/member-price-rule.entity';
export interface MemberPriceRuleInput {
    scope: MemberPriceRuleScope;
    categoryId?: number | null;
    memberLevel: number;
    discountPercent: number;
    active?: boolean;
    priority?: number;
}
/**
 * 会员价规则服务：
 * - 提供 CRUD（admin 管理）
 * - 提供 findEffectiveRule：按 channel + memberLevel + category 查询生效规则
 *   优先级：category > global（priority 字段大的优先）
 */
export declare class MemberPriceRuleService {
    private connection;
    constructor(connection: Connection);
    /**
     * 解析并校验渠道：只允许操作当前请求渠道的数据。
     * 显式传了其他渠道 id 时直接拒绝，避免跨租户读取/改写。
     */
    private assertChannel;
    findAll(ctx: RequestContext, channelId?: number): Promise<MemberPriceRule[]>;
    /**
     * 按 id + 渠道查询。跨渠道 id 返回 null（调用方据此拒绝 update/delete）。
     */
    findOne(ctx: RequestContext, id: number): Promise<MemberPriceRule | null>;
    create(ctx: RequestContext, input: MemberPriceRuleInput): Promise<MemberPriceRule>;
    update(ctx: RequestContext, id: number, input: Partial<MemberPriceRuleInput>): Promise<MemberPriceRule>;
    delete(ctx: RequestContext, id: number): Promise<boolean>;
    /**
     * 查询生效规则：先查 category（指定 categoryId + memberLevel），未命中则查 global。
     * 若同一层有多条规则，priority 大者优先；priority 相同取 discountPercent 更低（更优惠）。
     */
    findEffectiveRule(ctx: RequestContext, memberLevel: number, categoryId?: number | null): Promise<MemberPriceRule | null>;
    private validateInput;
}
