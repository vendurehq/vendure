import { describe, expect, it, vi } from 'vitest';

import { buildDashboardUserContext } from './dashboard-user-context.js';

const role = (code: string, channelIds: string[] = ['1']) => ({
    id: `role-${code}`,
    code,
    description: code,
    channels: channelIds.map(id => ({ id })),
});

const administrator = (roles = [role('floor-staff')]) => ({
    id: 'admin-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    emailAddress: 'ada@example.com',
    user: { id: 'user-1', identifier: 'ada', roles },
});

describe('buildDashboardUserContext', () => {
    it('returns empty collections when logged out', () => {
        const ctx = buildDashboardUserContext({
            administrator: undefined,
            channels: undefined,
            activeChannel: undefined,
            customFields: undefined,
            hasPermissions: () => false,
        });
        expect(ctx.administrator).toBeUndefined();
        expect(ctx.roles).toEqual([]);
        expect(ctx.channels).toEqual([]);
        expect(ctx.isSuperAdmin).toBe(false);
    });

    it('exposes roles unscoped, including roles from non-active channels', () => {
        const ctx = buildDashboardUserContext({
            administrator: administrator([role('seller', ['2'])]),
            channels: [{ id: '1', token: 't1', code: 'default', permissions: ['ReadCatalog'] }],
            activeChannel: { id: '1', token: 't1', code: 'default', permissions: ['ReadCatalog'] },
            customFields: undefined,
            hasPermissions: () => true,
        });
        expect(ctx.roles.map(r => r.code)).toEqual(['seller']);
        expect(ctx.roles[0].channels).toEqual([{ id: '2' }]);
    });

    it('detects the SuperAdmin role by code', () => {
        const ctx = buildDashboardUserContext({
            administrator: administrator([role('__super_admin_role__')]),
            channels: [],
            activeChannel: undefined,
            customFields: undefined,
            hasPermissions: () => true,
        });
        expect(ctx.isSuperAdmin).toBe(true);
    });

    it('merges custom fields onto the administrator', () => {
        const ctx = buildDashboardUserContext({
            administrator: administrator(),
            channels: [],
            activeChannel: undefined,
            customFields: { isFloorStaff: true },
            hasPermissions: () => true,
        });
        expect(ctx.administrator?.customFields?.isFloorStaff).toBe(true);
    });

    it('passes hasPermissions through', () => {
        const hasPermissions = vi.fn().mockReturnValue(true);
        const ctx = buildDashboardUserContext({
            administrator: administrator(),
            channels: [],
            activeChannel: undefined,
            customFields: undefined,
            hasPermissions,
        });
        expect(ctx.hasPermissions(['ReadOrder'])).toBe(true);
        expect(hasPermissions).toHaveBeenCalledWith(['ReadOrder']);
    });
});
