"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantConfigAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const core_1 = require("@vendure/core");
const auth_config_service_1 = require("../auth/auth-config.service");
const pay_config_service_1 = require("../payment/pay-config.service");
const map_config_service_1 = require("../map/map-config.service");
const sso_provider_service_1 = require("../auth/sso-provider.service");
const basic_config_service_1 = require("../tenant/basic-config.service");
const multi_language_config_service_1 = require("../tenant/multi-language-config.service");
const service_notify_config_service_1 = require("../tenant/service-notify-config.service");
class PermissionError extends Error {
    constructor(code) {
        super(code);
        this.name = 'PermissionError';
    }
}
/** 租户配置专用权限（在 dev-config customPermissions 中注册） */
const TENANT_SETTINGS_MANAGE = 'TenantSettingsManage';
let TenantConfigAdminResolver = class TenantConfigAdminResolver {
    constructor(authConfigService, payConfigService, mapConfigService, ssoProviderService, basicConfigService, multiLanguageConfigService, serviceNotifyConfigService, connection) {
        this.authConfigService = authConfigService;
        this.payConfigService = payConfigService;
        this.mapConfigService = mapConfigService;
        this.ssoProviderService = ssoProviderService;
        this.basicConfigService = basicConfigService;
        this.multiLanguageConfigService = multiLanguageConfigService;
        this.serviceNotifyConfigService = serviceNotifyConfigService;
        this.connection = connection;
    }
    canEdit(ctx, channelId) {
        var _a, _b;
        if (ctx.userHasPermissions([core_1.Permission.SuperAdmin]))
            return true;
        // C2：必须是该渠道成员，且持有租户配置专用权限（不能再用全站 UpdateSettings 替代）
        if (!ctx.userHasPermissions([TENANT_SETTINGS_MANAGE]))
            return false;
        // Vendure API: ctx.session.user.channelPermissions 是 { id, token, code, permissions }[]
        const channelPermissions = ((_b = (_a = ctx.session) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.channelPermissions) || [];
        return channelPermissions.some((c) => String(c.id) === String(channelId));
    }
    assertCanWrite(ctx, channelId) {
        if (!this.canEdit(ctx, channelId))
            throw new PermissionError('TENANT_CONFIG_FORBIDDEN');
    }
    async tenantConfig(ctx, args) {
        // 读权限:super-admin 或关联 channel,无权限则抛错(与测试规格一致)
        this.assertCanWrite(ctx, args.channelId);
        const [auth, pay, map] = await Promise.all([
            this.authConfigService.getMasked(ctx, args.channelId),
            this.payConfigService.getMasked(ctx, args.channelId),
            this.mapConfigService.getMasked(ctx, args.channelId),
        ]);
        return { channelId: args.channelId, auth, pay, map, canEdit: true };
    }
    async updateTenantConfig(ctx, args) {
        const { channelId, authPatch, payPatch, mapPatch } = args.input;
        this.assertCanWrite(ctx, channelId);
        if (authPatch)
            await this.authConfigService.update(ctx, channelId, authPatch);
        if (payPatch)
            await this.payConfigService.update(ctx, channelId, payPatch);
        if (mapPatch)
            await this.mapConfigService.update(ctx, channelId, mapPatch);
        await this.writeAudit(ctx, channelId, [authPatch && 'auth', payPatch && 'pay', mapPatch && 'map'].filter(Boolean));
        return this.tenantConfig(ctx, { channelId });
    }
    async tenantSettings(ctx, channelId) {
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
    async updateTenantBasic(ctx, args) {
        const { channelId, patch } = args.input;
        this.assertCanWrite(ctx, channelId);
        await this.basicConfigService.update(ctx, channelId, patch);
        await this.writeAudit(ctx, channelId, ['basic']);
        return this.tenantSettings(ctx, channelId);
    }
    async updateTenantMultiLanguage(ctx, args) {
        const { channelId, patch } = args.input;
        this.assertCanWrite(ctx, channelId);
        await this.multiLanguageConfigService.update(ctx, channelId, patch);
        await this.writeAudit(ctx, channelId, ['multiLanguage']);
        return this.tenantSettings(ctx, channelId);
    }
    async updateTenantServiceNotify(ctx, args) {
        const { channelId, patch } = args.input;
        this.assertCanWrite(ctx, channelId);
        await this.serviceNotifyConfigService.update(ctx, channelId, patch);
        await this.writeAudit(ctx, channelId, ['serviceNotify']);
        return this.tenantSettings(ctx, channelId);
    }
    // 抽取审计写入为私有方法（复用现有 insert 逻辑）
    async writeAudit(ctx, channelId, sections) {
        var _a, _b;
        const operator = ((_b = (_a = ctx.session) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.identifier) || ctx.activeUserId;
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
    async testSsoConnection(ctx, args) {
        const { channelId, providerKey, newClientSecret } = args.input;
        this.assertCanWrite(ctx, channelId);
        return this.ssoProviderService.testConnection(ctx, channelId, providerKey, newClientSecret);
    }
};
exports.TenantConfigAdminResolver = TenantConfigAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "tenantConfig", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "updateTenantConfig", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "tenantSettings", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "updateTenantBasic", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "updateTenantMultiLanguage", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "updateTenantServiceNotify", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantConfigAdminResolver.prototype, "testSsoConnection", null);
exports.TenantConfigAdminResolver = TenantConfigAdminResolver = __decorate([
    (0, common_1.Injectable)(),
    (0, graphql_1.Resolver)(),
    __param(7, (0, typeorm_1.InjectConnection)()),
    __metadata("design:paramtypes", [auth_config_service_1.AuthConfigService,
        pay_config_service_1.PayConfigService,
        map_config_service_1.MapConfigService,
        sso_provider_service_1.SsoProviderService,
        basic_config_service_1.BasicConfigService,
        multi_language_config_service_1.MultiLanguageConfigService,
        service_notify_config_service_1.ServiceNotifyConfigService,
        typeorm_2.Connection])
], TenantConfigAdminResolver);
//# sourceMappingURL=tenant-config-admin.resolver.js.map