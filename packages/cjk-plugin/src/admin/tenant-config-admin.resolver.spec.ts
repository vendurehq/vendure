import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantConfigAdminResolver } from './tenant-config-admin.resolver';

// Mock services
const mockAuthConfigService: any = { getMasked: vi.fn().mockResolvedValue({ enabledMethods: [] }) };
const mockPayConfigService: any = { getMasked: vi.fn().mockResolvedValue(null) };
const mockMapConfigService: any = { getMasked: vi.fn().mockResolvedValue(null) };
const mockSsoProviderService: any = { testConnection: vi.fn() };
const mockBasicConfigService: any = { get: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(null) };
const mockMultiLanguageConfigService: any = { get: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(null) };
const mockServiceNotifyConfigService: any = { getMasked: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(null) };
const mockConnection: any = {
    createQueryBuilder: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        into: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({}),
    }),
};

// Mock ctx — 模拟 ctx.session.user.channelPermissions 结构
function makeCtx(opts: { isSuperAdmin?: boolean; channelIds?: string[]; tenantSettingsManage?: boolean } = {}) {
    const channelPermissions = (opts.channelIds || []).map(id => ({ id, token: `t-${id}`, code: `c-${id}`, permissions: [] }));
    const user: any = { id: 1, identifier: 'admin@test', channelPermissions };
    return {
        session: { user },
        userHasPermissions: (perms: any[]) =>
            opts.isSuperAdmin === true ||
            (opts.tenantSettingsManage === true && perms.includes('TenantSettingsManage')),
        activeUserId: 1,
    } as any;
}

describe('TenantConfigAdminResolver', () => {
    let resolver: TenantConfigAdminResolver;

    beforeEach(() => {
        resolver = new TenantConfigAdminResolver(
            mockAuthConfigService,
            mockPayConfigService,
            mockMapConfigService,
            mockSsoProviderService,
            mockBasicConfigService,
            mockMultiLanguageConfigService,
            mockServiceNotifyConfigService,
            mockConnection,
        );
    });

    it('allows super-admin to read any channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: true });
        const result = await resolver.tenantConfig(ctx, { channelId: '99' });
        expect(result.canEdit).toBe(true);
        expect(result.channelId).toBe('99');
    });

    it('allows tenant admin to read associated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1', '2'], tenantSettingsManage: true });
        const result = await resolver.tenantConfig(ctx, { channelId: '2' });
        expect(result.canEdit).toBe(true);
    });

    it('rejects tenant admin reading unassociated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1'], tenantSettingsManage: true });
        await expect(resolver.tenantConfig(ctx, { channelId: '99' })).rejects.toThrow(/TENANT_CONFIG_FORBIDDEN/);
    });

    it('updateTenantConfig rejects unassociated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1'], tenantSettingsManage: true });
        await expect(
            resolver.updateTenantConfig(ctx, { input: { channelId: '99', payPatch: {} } }),
        ).rejects.toThrow(/TENANT_CONFIG_FORBIDDEN/);
    });

    it('tenantSettings rejects unassociated channel', async () => {
        const ctx = makeCtx({ isSuperAdmin: false, channelIds: ['1'], tenantSettingsManage: true });
        await expect(resolver.tenantSettings(ctx, '99')).rejects.toThrow(/TENANT_CONFIG_FORBIDDEN/);
    });

    it('updateTenantBasic writes audit and returns settings', async () => {
        const ctx = makeCtx({ isSuperAdmin: true });
        const result = await resolver.updateTenantBasic(ctx, { input: { channelId: '1', patch: { tenantName: 'X' } } });
        expect(result.channelId).toBe('1');
        expect(mockConnection.createQueryBuilder).toHaveBeenCalled();
    });
});
