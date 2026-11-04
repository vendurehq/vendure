import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { Connection } from 'typeorm';
import { RequestContext, Permission, Allow, Ctx } from '@vendure/core';
import { AuthConfigService } from '../auth/auth-config.service';
import { PayConfigService } from '../payment/pay-config.service';
import { MapConfigService } from '../map/map-config.service';
import { SsoProviderService } from '../auth/sso-provider.service';
import { BasicConfigService } from '../tenant/basic-config.service';
import { MultiLanguageConfigService } from '../tenant/multi-language-config.service';
import { ServiceNotifyConfigService } from '../tenant/service-notify-config.service';

class PermissionError extends Error {
    constructor(code: string) {
        super(code);
        this.name = 'PermissionError';
    }
}

/** 租户配置专用权限（在 dev-config customPermissions 中注册） */
const TENANT_SETTINGS_MANAGE = 'TenantSettingsManage' as Permission;

@Injectable()
@Resolver()
export class TenantConfigAdminResolver {
    constructor(
        private authConfigService: AuthConfigService,
        private payConfigService: PayConfigService,
        private mapConfigService: MapConfigService,
        private ssoProviderService: SsoProviderService,
        private basicConfigService: BasicConfigService,
        private multiLanguageConfigService: MultiLanguageConfigService,
        private serviceNotifyConfigService: ServiceNotifyConfigService,
        @InjectConnection() private connection: Connection,
    ) {}

    private canEdit(ctx: RequestContext, channelId: string): boolean {
        if (ctx.userHasPermissions([Permission.SuperAdmin])) return true;
        // C2：必须是该渠道成员，且持有租户配置专用权限（不能再用全站 UpdateSettings 替代）
        if (!ctx.userHasPermissions([TENANT_SETTINGS_MANAGE])) return false;
        // Vendure API: ctx.session.user.channelPermissions 是 { id, token, code, permissions }[]
        const channelPermissions = (ctx as any).session?.user?.channelPermissions || [];
        return channelPermissions.some((c: any) => String(c.id) === String(channelId));
    }

    private assertCanWrite(ctx: RequestContext, channelId: string) {
        if (!this.canEdit(ctx, channelId)) throw new PermissionError('TENANT_CONFIG_FORBIDDEN');
    }

    @Query()
    @Allow(Permission.Authenticated)
    async tenantConfig(@Ctx() ctx: RequestContext, @Args() args: { channelId: string }) {
        // 读权限:super-admin 或关联 channel,无权限则抛错(与测试规格一致)
        this.assertCanWrite(ctx, args.channelId);
        const [auth, pay, map] = await Promise.all([
            this.authConfigService.getMasked(ctx, args.channelId),
            this.payConfigService.getMasked(ctx, args.channelId),
            this.mapConfigService.getMasked(ctx, args.channelId),
        ]);
        return { channelId: args.channelId, auth, pay, map, canEdit: true };
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async updateTenantConfig(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        const { channelId, authPatch, payPatch, mapPatch } = args.input;
        this.assertCanWrite(ctx, channelId);
        if (authPatch) await this.authConfigService.update(ctx, channelId, authPatch);
        if (payPatch) await this.payConfigService.update(ctx, channelId, payPatch);
        if (mapPatch) await this.mapConfigService.update(ctx, channelId, mapPatch);
        await this.writeAudit(ctx, channelId, [authPatch && 'auth', payPatch && 'pay', mapPatch && 'map'].filter(Boolean));
        return this.tenantConfig(ctx, { channelId });
    }

    @Query()
    @Allow(Permission.Authenticated)
    async tenantSettings(@Ctx() ctx: RequestContext, @Args('channelId') channelId: string) {
        this.assertCanWrite(ctx, channelId);
        const [basic, auth, pay, map, serviceNotify, multiLanguage] = await Promise.all([
            this.basicConfigService.get(ctx, channelId),
            this.authConfigService.getMasked(ctx, channelId),
            this.payConfigService.getMasked(ctx, channelId),
            this.mapConfigService.getMasked(ctx, channelId),
            this.serviceNotifyConfigService.getMasked(ctx, channelId),
            this.multiLanguageConfigService.get(ctx, channelId),
        ]);
        return { channelId, basic, auth, pay, map, serviceNotify, multiLanguage, canEdit: true };
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async updateTenantBasic(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        const { channelId, patch } = args.input;
        this.assertCanWrite(ctx, channelId);
        await this.basicConfigService.update(ctx, channelId, patch);
        await this.writeAudit(ctx, channelId, ['basic']);
        return this.tenantSettings(ctx, channelId);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async updateTenantMultiLanguage(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        const { channelId, patch } = args.input;
        this.assertCanWrite(ctx, channelId);
        await this.multiLanguageConfigService.update(ctx, channelId, patch);
        await this.writeAudit(ctx, channelId, ['multiLanguage']);
        return this.tenantSettings(ctx, channelId);
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async updateTenantServiceNotify(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        const { channelId, patch } = args.input;
        this.assertCanWrite(ctx, channelId);
        await this.serviceNotifyConfigService.update(ctx, channelId, patch);
        await this.writeAudit(ctx, channelId, ['serviceNotify']);
        return this.tenantSettings(ctx, channelId);
    }

    // 抽取审计写入为私有方法（复用现有 insert 逻辑）
    private async writeAudit(ctx: RequestContext, channelId: string, sections: string[]) {
        const operator = (ctx as any).session?.user?.identifier || ctx.activeUserId;
        await this.connection
            .createQueryBuilder()
            .insert()
            .into('history_entry')
            .values({
                createdAt: () => 'NOW()',
                updatedAt: () => 'NOW()',
                type: 'TENANT_CONFIG_UPDATE',
                isPublic: false,
                data: JSON.stringify({ channelId, sections, operator }),
                discriminator: 'tenant-config',
            })
            .execute();
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    async testSsoConnection(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        const { channelId, providerKey, newClientSecret } = args.input;
        this.assertCanWrite(ctx, channelId);
        return this.ssoProviderService.testConnection(ctx, channelId, providerKey, newClientSecret);
    }
}
