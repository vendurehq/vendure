import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Channel, Ctx, Permission, RequestContext, ChannelService, TransactionalConnection, ProductService } from '@vendure/core';
import { Inject } from '@nestjs/common';
import { TenantMemberService } from './tenant-member.service';
import { TenantMember } from './tenant-member.entity';

/** 租户位容量：预留前 20 个官方租户位（tenantNo 1-20，见 seedOfficialTenants） */
export const TENANT_SLOT_CAPACITY = 20;

@Resolver()
export class TenantAdminResolver {
    constructor(
        @Inject(ChannelService) private channelService: ChannelService,
        @Inject(TransactionalConnection) private connection: TransactionalConnection,
        @Inject(TenantMemberService) private tenantMemberService: TenantMemberService,
        @Inject(ProductService) private productService: ProductService,
    ) {}

    /** 租户位总览：capacity=20，slots 按 tenantNo 1-20 列出每格的占用情况 */
    @Query()
    @Allow(Permission.SuperAdmin)
    async tenantSlots(@Ctx() ctx: RequestContext): Promise<{ capacity: number; used: number; slots: any[] }> {
        const { Channel } = await import('@vendure/core');
        const channels: any[] = await this.connection.getRepository(ctx, Channel).find({ take: 200000 } as any) as any[];
        const byNo = new Map<number, any>();
        for (const c of channels) {
            const no = Number(c.customFields?.tenantNo);
            if (Number.isFinite(no)) byNo.set(no, c);
        }
        const capacity = TENANT_SLOT_CAPACITY;
        const slots = Array.from({ length: capacity }, (_, i) => {
            const no = i + 1;
            const c = byNo.get(no);
            return {
                no,
                occupied: !!c,
                tenantId: c ? String(c.id) : null,
                name: c ? (c.customFields?.shopName || c.code || null) : null,
            };
        });
        return { capacity, used: slots.filter((s) => s.occupied).length, slots };
    }

    /** 清空指定租户名下全部商品（从零开始）：对该租户 channel 关联的每个商品做软删（softDelete）。不触碰配送/支付/账户等。 */
    @Mutation()
    @Allow(Permission.SuperAdmin)
    async clearTenantProducts(@Ctx() ctx: RequestContext, @Args('channelId') channelId: string): Promise<number> {
        const { Product } = await import('@vendure/core');
        const repo = this.connection.getRepository(ctx, Product);
        const products: any[] = await repo
            .createQueryBuilder('p')
            .innerJoin('p.channels', 'ch')
            .where('ch.id = :id', { id: channelId })
            .getMany() as any[];
        let done = 0;
        for (const p of products) {
            try {
                await this.productService.softDelete(ctx, (p as any).id);
                done++;
            } catch {
                // 该商品被订单等引用时跳过，逐个尽力清理
            }
        }
        return done;
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async tenants(
        @Ctx() ctx: RequestContext,
        @Args() args: { options: { skip?: number; take?: number; filter?: any } },
    ): Promise<{ items: any[]; totalItems: number }> {
        const filter = args.options?.filter ?? {};
        const qb = this.connection.getRepository(ctx, Channel).createQueryBuilder('channel');
        // 关键字：租户 code / 店铺名（列表展示字段）
        const keyword = typeof filter.keyword === 'string' ? filter.keyword.trim() : '';
        if (keyword) {
            qb.andWhere(
                '(channel.code ILIKE :kw OR channel."customFieldsShopname" ILIKE :kw)',
                { kw: `%${keyword}%` },
            );
        }
        // 状态：enabled / disabled（也兼容 boolean 与 1/0）
        const status = filter.status;
        if (status !== undefined && status !== null && status !== '') {
            const enabled =
                status === true ||
                String(status).toLowerCase() === 'enabled' ||
                String(status) === '1';
            qb.andWhere('channel."customFieldsEnabled" = :enabled', { enabled });
        }
        qb.skip(args.options?.skip ?? 0).take(args.options?.take ?? 50);
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async tenant(@Ctx() ctx: RequestContext, @Args('id') id: string): Promise<any> {
        return this.channelService.findOne(ctx, id as any);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async createTenant(
        @Ctx() ctx: RequestContext,
        @Args()
        args: {
            input: {
                name: string;
                token?: string;
                isOfficial?: boolean;
                defaultLanguageCode?: string;
                currencyCode?: string;
                customDomains?: string[];
                domain?: string;
                extraCustomFields?: Record<string, unknown>;
            };
        },
    ): Promise<any> {
        return this.tenantMemberService.createChannel(ctx, args.input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async updateTenant(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; input: { name?: string; tenantNo?: number; isOfficial?: boolean; domain?: string; industryType?: string; storefrontMode?: string; storefrontHomeLayout?: string; couponFloorGroups?: string; firstBuyDiscount?: number; couponCampaign?: string; billpayMaxSalePrice?: number; billpayMaxFaceValue?: number; billpayMaxBundleTotal?: number; billpayMinValidDays?: number; billpayExpireRefundPolicy?: string } },
    ): Promise<any> {
        await this.tenantMemberService.updateChannel(ctx, args.id, args.input);
        return this.channelService.findOne(ctx, args.id as any);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async setTenantEnabled(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; enabled: boolean },
    ): Promise<any> {
        await this.tenantMemberService.setChannelEnabled(ctx, args.id, args.enabled);
        return this.channelService.findOne(ctx, args.id as any);
    }

    /** 软删：标记停用，不做物理删除 */
    @Mutation()
    @Allow(Permission.SuperAdmin)
    async deleteTenant(@Ctx() ctx: RequestContext, @Args('id') id: string): Promise<boolean> {
        await this.tenantMemberService.setChannelEnabled(ctx, id, false);
        return true;
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async tenantAdministrators(
        @Ctx() ctx: RequestContext,
        @Args('channelId') channelId: string,
    ): Promise<TenantMember[]> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const members = await repo.find({ where: { channelId }, order: { createdAt: 'ASC' } });
        return Promise.all(members.map((m) => this.tenantMemberService.memberToView(ctx, m))) as Promise<any[]>;
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async createTenantAdministrator(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: string; input: any },
    ): Promise<TenantMember> {
        return this.tenantMemberService.createTenantAdministrator(ctx, args.channelId, args.input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async setTenantAdministratorEnabled(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; enabled: boolean },
    ): Promise<TenantMember> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id: args.id } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        await this.tenantMemberService.setMemberEnabled(ctx, member.channelId, args.id, args.enabled);
        return repo.findOne({ where: { id: args.id } } as any) as any;
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async deleteTenantAdministrator(@Ctx() ctx: RequestContext, @Args('id') id: string): Promise<boolean> {
        const repo = this.connection.getRepository(ctx, TenantMember);
        const member = await repo.findOne({ where: { id } });
        if (!member) throw new Error('MEMBER_NOT_FOUND');
        await this.tenantMemberService.removeMember(ctx, member.channelId, id);
        return true;
    }

    /** 重置租户管理人密码（管理员 Tab 某成员）：随机一次性口令，返回明文供本次转交（仅超管） */
    @Mutation()
    @Allow(Permission.SuperAdmin)
    async resetTenantAdministratorPassword(@Ctx() ctx: RequestContext, @Args('memberId') memberId: string): Promise<string> {
        const member = await this.tenantMemberService.resetAdminPassword(ctx, memberId);
        return (member as any).initialPassword as string;
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async tenantRoles(@Ctx() ctx: RequestContext, @Args('channelId') channelId: string): Promise<any[]> {
        return this.tenantMemberService.rolesForChannel(ctx, channelId);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async createTenantRole(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: string; input: { code: string; description: string; permissions: string[] } },
    ): Promise<any> {
        return this.tenantMemberService.createTenantRole(ctx, args.channelId, args.input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async updateTenantRole(
        @Ctx() ctx: RequestContext,
        @Args() args: { roleId: string; input: { code?: string; description?: string; permissions?: string[] } },
    ): Promise<any> {
        return this.tenantMemberService.updateTenantRole(ctx, args.roleId, args.input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async deleteTenantRole(@Ctx() ctx: RequestContext, @Args('roleId') roleId: string): Promise<boolean> {
        await this.tenantMemberService.deleteTenantRole(ctx, roleId);
        return true;
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async updateTenantMemberRoles(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; channelId: string; roleIds: string[] },
    ): Promise<boolean> {
        await this.tenantMemberService.updateTenantMemberRoles(ctx, args.channelId, args.id, args.roleIds);
        return true;
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async setTenantMemberRedeemProfiles(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; shippingProfileIds: string[] },
    ): Promise<any> {
        return this.tenantMemberService.setMemberRedeemProfiles(
            ctx,
            ctx.channelId,
            args.id,
            args.shippingProfileIds ?? [],
        );
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async tenantSearchAdmins(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: string; keyword?: string },
    ): Promise<any[]> {
        return this.tenantMemberService.searchAdmins(ctx, args.channelId, args.keyword, 10);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async tenantLinkMember(
        @Ctx() ctx: RequestContext,
        @Args() args: {
            channelId: string;
            administratorId: string;
            roleIds?: string[];
            displayName?: string;
            phone?: string;
            remark?: string;
        },
    ): Promise<any> {
        return this.tenantMemberService.linkMember(ctx, args.channelId, {
            administratorId: args.administratorId,
            roleIds: args.roleIds,
            displayName: args.displayName,
            phone: args.phone,
            remark: args.remark,
        });
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async importDefaultRoles(
        @Ctx() ctx: RequestContext,
        @Args('channelId') channelId: string,
    ): Promise<any[]> {
        return this.tenantMemberService.importDefaultRoles(ctx, channelId);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async globalRoles(@Ctx() ctx: RequestContext): Promise<any[]> {
        return this.tenantMemberService.globalRoles(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async globalRoleTemplates(@Ctx() ctx: RequestContext): Promise<any[]> {
        return this.tenantMemberService.globalRoleTemplates(ctx);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async createGlobalRole(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelIds: string[]; input: { code: string; description: string; permissions: string[] } },
    ): Promise<any[]> {
        return this.tenantMemberService.createGlobalRoleWithChannels(ctx, args.channelIds, args.input);
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async referGlobalRoleToChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: { roleId: string; channelId: string },
    ): Promise<boolean> {
        await this.tenantMemberService.referGlobalRoleToChannel(ctx, args.roleId, args.channelId);
        return true;
    }

    @Mutation()
    @Allow(Permission.SuperAdmin)
    async unreferGlobalRoleFromChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: { roleId: string; channelId: string },
    ): Promise<boolean> {
        await this.tenantMemberService.unreferGlobalRoleFromChannel(ctx, args.roleId, args.channelId);
        return true;
    }
}
