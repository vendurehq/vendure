"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const tenant_config_admin_resolver_1 = require("./tenant-config-admin.resolver");
// Mock services
const mockAuthConfigService = { getMasked: vitest_1.vi.fn().mockResolvedValue({ enabledMethods: [] }) };
const mockPayConfigService = { getMasked: vitest_1.vi.fn().mockResolvedValue(null) };
const mockMapConfigService = { getMasked: vitest_1.vi.fn().mockResolvedValue(null) };
const mockSsoProviderService = { testConnection: vitest_1.vi.fn() };
const mockBasicConfigService = { get: vitest_1.vi.fn().mockResolvedValue(null), update: vitest_1.vi.fn().mockResolvedValue(null) };
const mockMultiLanguageConfigService = { get: vitest_1.vi.fn().mockResolvedValue(null), update: vitest_1.vi.fn().mockResolvedValue(null) };
const mockServiceNotifyConfigService = { getMasked: vitest_1.vi.fn().mockResolvedValue(null), update: vitest_1.vi.fn().mockResolvedValue(null) };
const mockConnection = {
    createQueryBuilder: vitest_1.vi.fn().mockReturnValue({
        insert: vitest_1.vi.fn().mockReturnThis(),
        into: vitest_1.vi.fn().mockReturnThis(),
        values: vitest_1.vi.fn().mockReturnThis(),
        execute: vitest_1.vi.fn().mockResolvedValue({}),
    }),
};
// Mock ctx — 模拟 ctx.session.user.channelPermissions 结构
function makeCtx(opts = {}) {
    const channelPermissions = (opts.channelIds || []).map(id => ({ id, token: `t-${id}`, code: `c-${id}`, permissions: [] }));
    const user = { id: 1, identifier: 'admin@test', channelPermissions };
    return {
        session: { user },
        userHasPermissions: (perms) => opts.isSuperAdmin === true ||
            (opts.tenantSettingsManage === true && perms.includes('TenantSettingsManage')),
        activeUserId: 1,
    };
}
(0, vitest_1.describe)('TenantConfigAdminResolver', () => {
    let resolver;
    (0, vitest_1.beforeEach)(() => {
        resolver = new tenant_config_admin_resolver_1.TenantConfigAdminResolver(mockAuthConfigService, mockPayConfigService, mockMapConfigService, mockSsoProviderService, mockBasicConfigService, mockMultiLanguageConfigService, mockServiceNotifyConfigService, mockConnection);
    });
    (0, vitest_1.it)('allows super-admin to read any channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: true });
        const result = await resolver.tenantConfig(ctx, { channelId: '99' });
        (0, vitest_1.expect)(result.canEdit).toBe(true);
        (0, vitest_1.expect)(result.channelId).toBe('99');
    });
    (0, vitest_1.it)('allows tenant admin to read associated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1', '2'], tenantSettingsManage: true });
        const result = await resolver.tenantConfig(ctx, { channelId: '2' });
        (0, vitest_1.expect)(result.canEdit).toBe(true);
    });
    (0, vitest_1.it)('rejects tenant admin reading unassociated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1'], tenantSettingsManage: true });
        await (0, vitest_1.expect)(resolver.tenantConfig(ctx, { channelId: '99' })).rejects.toThrow(/TENANT_CONFIG_FORBIDDEN/);
    });
    (0, vitest_1.it)('updateTenantConfig rejects unassociated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1'], tenantSettingsManage: true });
        await (0, vitest_1.expect)(resolver.updateTenantConfig(ctx, { input: { channelId: '99', payPatch: {} } })).rejects.toThrow(/TENANT_CONFIG_FORBIDDEN/);
    });
    (0, vitest_1.it)('tenantSettings rejects unassociated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1'], tenantSettingsManage: true });
        await (0, vitest_1.expect)(resolver.tenantSettings(ctx, '99')).rejects.toThrow(/TENANT_CONFIG_FORBIDDEN/);
    });
    (0, vitest_1.it)('updateTenantBasic writes audit and returns settings', async () => {
        const ctx = makeCtx({ isSuperAdmin: true });
        const result = await resolver.updateTenantBasic(ctx, { input: { channelId: '1', patch: { tenantName: 'X' } } });
        (0, vitest_1.expect)(result.channelId).toBe('1');
        (0, vitest_1.expect)(mockConnection.createQueryBuilder).toHaveBeenCalled();
    });
});
//# sourceMappingURL=tenant-config-admin.resolver.spec.js.map