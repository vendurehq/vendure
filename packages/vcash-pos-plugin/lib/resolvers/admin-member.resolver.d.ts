import { AdministratorService, ChannelService, CustomerService, ID, RequestContext } from '@vendure/core';
import { MemberPriceRule } from '../entities/member-price-rule.entity';
import { PosSession } from '../entities/pos-session.entity';
import { MemberPriceRuleService } from '../services/member-price-rule.service';
import { MemberPriceRuleInput } from '../services/member-price-rule.service';
import { PosSessionService } from '../services/pos-session.service';
/**
 * 会员信息视图（POS 端展示用）。
 * 字段从 Customer + customFields(memberLevel/growthValue/points) 派生。
 * 注意：避免与 member-level-plugin 的 MemberInfo 类型冲突，命名为 PosMemberInfo。
 */
export declare class PosMemberInfo {
    customerId: string;
    firstName: string | null;
    lastName: string | null;
    emailAddress: string | null;
    phoneNumber: string | null;
    memberLevel: number;
    growthValue: number;
    points: number;
}
/**
 * POS 会员识别 API + 会员价规则管理 API。
 * - findMemberByPhone / findMemberByCode：收银员通过手机号/卡号识别会员
 * - bindSessionMember / unbindSessionMember：将会员绑定到当前班次，加购时自动应用会员价
 * - 会员价规则 CRUD：管理员配置 global/category 两层规则
 */
export declare class AdminMemberResolver {
    private customerService;
    private administratorService;
    private sessionService;
    private ruleService;
    private channelService;
    constructor(customerService: CustomerService, administratorService: AdministratorService, sessionService: PosSessionService, ruleService: MemberPriceRuleService, channelService: ChannelService);
    findMemberByPhone(ctx: RequestContext, phoneNumber: string): Promise<PosMemberInfo | null>;
    findMemberByCode(ctx: RequestContext, code: string): Promise<PosMemberInfo | null>;
    bindSessionMember(ctx: RequestContext, customerId: ID): Promise<PosSession>;
    unbindSessionMember(ctx: RequestContext): Promise<PosSession>;
    memberPriceRules(ctx: RequestContext, channelId?: string): Promise<MemberPriceRule[]>;
    memberPriceRule(ctx: RequestContext, id: string): Promise<MemberPriceRule | null>;
    createMemberPriceRule(ctx: RequestContext, input: MemberPriceRuleInput): Promise<MemberPriceRule>;
    updateMemberPriceRule(ctx: RequestContext, input: any): Promise<MemberPriceRule>;
    deleteMemberPriceRule(ctx: RequestContext, id: string): Promise<boolean>;
    private requireMyOpenSession;
    private resolveOperator;
    private findCustomerByPhone;
    private buildMemberInfo;
}
