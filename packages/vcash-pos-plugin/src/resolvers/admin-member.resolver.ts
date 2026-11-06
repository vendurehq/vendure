import { Inject } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  AdministratorService,
  Allow,
  ChannelService,
  Ctx,
  Customer,
  CustomerService,
  ID,
  Permission,
  RequestContext,
  UserInputError,
} from '@vendure/core';

import { posSessionPermission } from '../constants';
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
export class PosMemberInfo {
  customerId!: string;
  firstName!: string | null;
  lastName!: string | null;
  emailAddress!: string | null;
  phoneNumber!: string | null;
  memberLevel!: number;
  growthValue!: number;
  points!: number;
}

/**
 * POS 会员识别 API + 会员价规则管理 API。
 * - findMemberByPhone / findMemberByCode：收银员通过手机号/卡号识别会员
 * - bindSessionMember / unbindSessionMember：将会员绑定到当前班次，加购时自动应用会员价
 * - 会员价规则 CRUD：管理员配置 global/category 两层规则
 */
@Resolver()
export class AdminMemberResolver {
  constructor(
    @Inject(CustomerService) private customerService: CustomerService,
    @Inject(AdministratorService) private administratorService: AdministratorService,
    @Inject(PosSessionService) private sessionService: PosSessionService,
    @Inject(MemberPriceRuleService) private ruleService: MemberPriceRuleService,
    @Inject(ChannelService) private channelService: ChannelService,
  ) {}

  // ===== 会员识别 =====

  @Query()
  @Allow(Permission.ReadCustomer, posSessionPermission.Read)
  async findMemberByPhone(
    @Ctx() ctx: RequestContext,
    @Args('phoneNumber') phoneNumber: string,
  ): Promise<PosMemberInfo | null> {
    const customer = await this.findCustomerByPhone(ctx, phoneNumber);
    return customer ? this.buildMemberInfo(customer) : null;
  }

  @Query()
  @Allow(Permission.ReadCustomer, posSessionPermission.Read)
  async findMemberByCode(
    @Ctx() ctx: RequestContext,
    @Args('code') code: string,
  ): Promise<PosMemberInfo | null> {
    // code 直接使用 customer.id（数字字符串）
    const idNum = parseInt(code, 10);
    if (!Number.isFinite(idNum)) {
      throw new UserInputError('卡号格式无效，应为数字');
    }
    const customer = await this.customerService.findOne(ctx, idNum as ID);
    return customer ? this.buildMemberInfo(customer) : null;
  }

  @Mutation()
  @Allow(posSessionPermission.Update)
  async bindSessionMember(
    @Ctx() ctx: RequestContext,
    @Args('customerId') customerId: ID,
  ): Promise<PosSession> {
    const session = await this.requireMyOpenSession(ctx);
    const customer = await this.customerService.findOne(ctx, customerId);
    if (!customer) {
      throw new UserInputError(`会员 ${customerId} 不存在`);
    }
    session.customerId = Number(customer.id);
    session.customer = customer;
    return this.sessionService.save(session);
  }

  @Mutation()
  @Allow(posSessionPermission.Update)
  async unbindSessionMember(@Ctx() ctx: RequestContext): Promise<PosSession> {
    const session = await this.requireMyOpenSession(ctx);
    session.customerId = null;
    session.customer = null;
    return this.sessionService.save(session);
  }

  // ===== 会员价规则 CRUD =====

  @Query()
  @Allow(Permission.ReadSettings, posSessionPermission.Read)
  async memberPriceRules(
    @Ctx() ctx: RequestContext,
    @Args('channelId', { nullable: true }) channelId?: string,
  ): Promise<MemberPriceRule[]> {
    return this.ruleService.findAll(ctx, channelId ? parseInt(channelId, 10) : undefined);
  }

  @Query()
  @Allow(Permission.ReadSettings, posSessionPermission.Read)
  async memberPriceRule(
    @Ctx() ctx: RequestContext,
    @Args('id') id: string,
  ): Promise<MemberPriceRule | null> {
    return this.ruleService.findOne(ctx, parseInt(id, 10));
  }

  @Mutation()
  @Allow(Permission.CreateSettings, posSessionPermission.Create)
  async createMemberPriceRule(
    @Ctx() ctx: RequestContext,
    @Args('input') input: MemberPriceRuleInput,
  ): Promise<MemberPriceRule> {
    return this.ruleService.create(ctx, input);
  }

  @Mutation()
  @Allow(Permission.UpdateSettings, posSessionPermission.Update)
  async updateMemberPriceRule(
    @Ctx() ctx: RequestContext,
    @Args('input') input: any,
  ): Promise<MemberPriceRule> {
    return this.ruleService.update(ctx, parseInt(input.id, 10), input);
  }

  @Mutation()
  @Allow(Permission.DeleteSettings, posSessionPermission.Delete)
  async deleteMemberPriceRule(
    @Ctx() ctx: RequestContext,
    @Args('id') id: string,
  ): Promise<boolean> {
    return this.ruleService.delete(ctx, parseInt(id, 10));
  }

  // ===== Helpers =====

  private async requireMyOpenSession(ctx: RequestContext): Promise<PosSession> {
    const admin = await this.resolveOperator(ctx);
    if (!admin) throw new UserInputError('未登录或非管理员账号');
    const session = await this.sessionService.findMyOpenSession(Number(admin.id));
    if (!session) {
      throw new UserInputError('当前管理员无开班班次，请先开班');
    }
    return session;
  }

  private async resolveOperator(ctx: RequestContext) {
    if (!ctx.activeUserId) return null;
    return this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
  }

  private async findCustomerByPhone(ctx: RequestContext, phoneNumber: string): Promise<Customer | undefined> {
    // 使用 CustomerService 私有方法不可行，直接走 repository 查 phoneNumber
    const list = await this.customerService.findAll(ctx, {
      filter: { phoneNumber: { eq: phoneNumber } },
      take: 1,
    });
    return list.items[0];
  }

  private buildMemberInfo(customer: Customer): PosMemberInfo {
    const cf = (customer as any).customFields ?? {};
    return {
      customerId: customer.id as string,
      firstName: customer.firstName ?? null,
      lastName: customer.lastName ?? null,
      emailAddress: customer.emailAddress ?? null,
      phoneNumber: customer.phoneNumber ?? null,
      memberLevel: cf.memberLevel ?? 1,
      growthValue: cf.growthValue ?? 0,
      points: cf.points ?? 0,
    };
  }
}
