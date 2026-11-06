import { Args, Mutation, Query, Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, TransactionalConnection, Administrator, ID, ForbiddenError } from '@vendure/core';
import { Inject } from '@nestjs/common';
import { TenantMemberService, PERMISSION_CATALOG, PermissionCatalogGroup } from './tenant-member.service';
import { TenantMember } from './tenant-member.entity';
import { tenantMemberManagePermission, tenantRoleManagePermission } from './tenant-permissions';

/**
 * 租户管理员 API：所有操作强制限定在 ctx.channelId（当前请求租户）。
 */
@Resolver()
export class TenantMemberResolver {
    constructor(
        @Inject(TransactionalConnection) private connection: TransactionalConnection,
        @Inject(TenantMemberService) private tenantMemberService: TenantMemberService,
    ) {}

    @Query()
    @Allow(Permission.Authenticated)
    async tenantMembers(@Ctx() ctx: RequestContext): Promise<TenantMember[]> {
        this.tenantMemberService.assertChannelMember(ctx);
        const repo = this.connection.getRepository(ctx, TenantMember);
        const members = await repo.find({ where: { channelId: String(ctx.channelId) }, order: { createdAt: 'ASC' } });
        return Promise.all(members.map((m) => this.tenantMemberService.memberToView(ctx, m))) as Promise<any[]>;
    }

    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async createTenantMember(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: any },
    ): Promise<TenantMember> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.createTenantAdministrator(ctx, ctx.channelId, args.input);
    }

    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async setTenantMemberEnabled(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; enabled: boolean },
    ): Promise<TenantMember> {
        this.tenantMemberService.assertChannelMember(ctx);
        await this.tenantMemberService.setMemberEnabled(ctx, ctx.channelId, args.id, args.enabled);
        const repo = this.connection.getRepository(ctx, TenantMember);
        return repo.findOne({ where: { id: args.id } } as any) as any;
    }

    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async deleteTenantMember(@Ctx() ctx: RequestContext, @Args('id') id: string): Promise<boolean> {
        this.tenantMemberService.assertChannelMember(ctx);
        await this.tenantMemberService.removeMember(ctx, ctx.channelId, id);
        return true;
    }

    @Query()
    @Allow(Permission.Authenticated)
    async permissionCatalog(): Promise<PermissionCatalogGroup[]> {
        return PERMISSION_CATALOG;
    }

    @Query()
    @Allow(Permission.Authenticated)
    async myTenantRoles(@Ctx() ctx: RequestContext): Promise<any[]> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.rolesForChannel(ctx, ctx.channelId);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async myGlobalRolesAvailable(@Ctx() ctx: RequestContext): Promise<any[]> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.globalRolesAvailable(ctx);
    }

    @Mutation()
    @Allow(tenantRoleManagePermission.Permission)
    async myImportDefaultRoles(@Ctx() ctx: RequestContext): Promise<any[]> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.myImportDefaultRoles(ctx);
    }

    @Mutation()
    @Allow(tenantRoleManagePermission.Permission)
    async myReferGlobalRole(@Ctx() ctx: RequestContext, @Args('roleId') roleId: ID): Promise<boolean> {
        this.tenantMemberService.assertChannelMember(ctx);
        await this.tenantMemberService.myReferGlobalRole(ctx, roleId);
        return true;
    }

    @Mutation()
    @Allow(tenantRoleManagePermission.Permission)
    async myUnreferGlobalRole(@Ctx() ctx: RequestContext, @Args('roleId') roleId: ID): Promise<boolean> {
        this.tenantMemberService.assertChannelMember(ctx);
        await this.tenantMemberService.myUnreferGlobalRole(ctx, roleId);
        return true;
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async myUpdateChannelCustomFields(
        @Ctx() ctx: RequestContext,
        @Args('input') input: Record<string, any>,
    ): Promise<any> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.updateMyChannelCustomFields(ctx, input);
    }

    @Mutation()
    @Allow(tenantRoleManagePermission.Permission)
    async myCreateTenantRole(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { code: string; description: string; permissions: string[] } },
    ): Promise<any> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.createTenantRole(ctx, ctx.channelId, args.input);
    }

    @Mutation()
    @Allow(tenantRoleManagePermission.Permission)
    async myUpdateTenantRole(
        @Ctx() ctx: RequestContext,
        @Args() args: { roleId: string; input: any },
    ): Promise<any> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.updateTenantRole(ctx, args.roleId, args.input, ctx.channelId);
    }

    @Mutation()
    @Allow(tenantRoleManagePermission.Permission)
    async myDeleteTenantRole(@Ctx() ctx: RequestContext, @Args('roleId') roleId: string): Promise<boolean> {
        this.tenantMemberService.assertChannelMember(ctx);
        await this.tenantMemberService.deleteTenantRole(ctx, roleId, ctx.channelId);
        return true;
    }

    /** 设置当前租户某人员的可核销配送档案白名单（受限核销员） */
    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async mySetTenantMemberRedeemProfiles(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; shippingProfileIds: string[] },
    ): Promise<any> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.setMemberRedeemProfiles(
            ctx,
            ctx.channelId,
            args.id,
            args.shippingProfileIds ?? [],
        );
    }

    /** 更换当前租户某人员的角色 */
    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async myUpdateTenantMemberRoles(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; roleIds: string[] },
    ): Promise<boolean> {
        await this.tenantMemberService.updateTenantMemberRoles(ctx, ctx.channelId, args.id, args.roleIds);
        return true;
    }

    @Query()
    @Allow(Permission.Authenticated)
    async mySearchAdmins(
        @Ctx() ctx: RequestContext,
        @Args('keyword') keyword?: string,
    ): Promise<any[]> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.searchAdmins(ctx, ctx.channelId, keyword, 10);
    }

    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async myLinkMember(
        @Ctx() ctx: RequestContext,
        @Args() args: { administratorId: string; roleIds?: string[]; displayName?: string; phone?: string; remark?: string },
    ): Promise<any> {
        this.tenantMemberService.assertChannelMember(ctx);
        return this.tenantMemberService.linkMember(ctx, ctx.channelId, {
            administratorId: args.administratorId,
            roleIds: args.roleIds,
            displayName: args.displayName,
            phone: args.phone,
            remark: args.remark,
        });
    }

    @ResolveField('roleIds')
    async roleIds(@Parent() member: TenantMember, @Ctx() ctx: RequestContext): Promise<ID[]> {
        return this.tenantMemberService.memberRoleIdsInChannel(ctx, member);
    }

    /** 租户自助重置本租户成员密码：随机一次性口令，返回明文供本次转交（权限门禁见 service） */
    @Mutation()
    @Allow(tenantMemberManagePermission.Permission)
    async myResetTenantMemberPassword(@Ctx() ctx: RequestContext, @Args('id') id: string): Promise<string> {
        this.tenantMemberService.assertChannelMember(ctx);
        const member = await this.tenantMemberService.resetMyMemberPassword(ctx, id);
        return (member as any).initialPassword as string;
    }

    /** 当前登录者修改自身密码（主动改密传旧密码校验；首登强改密 oldPassword 传 null 跳过校验） */
    // 不能使用 Permission.Authenticated：它按「当前渠道」判定，首登改密时前端尚未带渠道头，
    // ctx.channelId 落到 default 渠道而该账号只在 canteen-a 有角色 → 改密接口恒 403。
    // 本接口只改当前登录者自身密码，改为 Public + 显式登录校验（service 内仍会二次校验 activeUserId）。
    @Mutation()
    @Allow(Permission.Public)
    async tenantChangeMyPassword(
        @Ctx() ctx: RequestContext,
        @Args('oldPassword') oldPassword: string | null,
        @Args('newPassword') newPassword: string,
    ): Promise<boolean> {
        if (!ctx.activeUserId) throw new ForbiddenError();
        await this.tenantMemberService.changeMyPassword(ctx, oldPassword, newPassword);
        return true;
    }
}
