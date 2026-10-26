import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.hoisted(() => vi.fn());
const useChannelMock = vi.hoisted(() => vi.fn());
const usePermissionsMock = vi.hoisted(() => vi.fn());
const useAdminCustomFieldsMock = vi.hoisted(() => vi.fn());

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/vdb/hooks/use-auth.js', () => ({ useAuth: useAuthMock }));
vi.mock('@/vdb/hooks/use-channel.js', () => ({ useChannel: useChannelMock }));
vi.mock('@/vdb/hooks/use-permissions.js', () => ({ usePermissions: usePermissionsMock }));
vi.mock('@/vdb/hooks/use-admin-custom-fields.js', () => ({
    useAdminCustomFields: useAdminCustomFieldsMock,
}));

import { useDashboardUserContext } from './use-dashboard-user-context.js';

type HookResult = ReturnType<typeof useDashboardUserContext>;

const administrator = {
    id: 'admin-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    emailAddress: 'ada@example.com',
    user: {
        id: 'user-1',
        identifier: 'ada',
        roles: [
            { id: 'role-1', code: 'floor-staff', description: 'Floor staff', channels: [{ id: 'ch-2' }] },
        ],
    },
};

// The permission-bearing channel list, as returned by useAuth.
const channels = [
    { id: 'ch-1', token: 'default', code: '__default_channel__', permissions: ['ReadCatalog'] },
    { id: 'ch-2', token: 'store', code: 'store', permissions: ['ReadOrder'] },
];

let result: HookResult | undefined;
let probeOptions: Parameters<typeof useDashboardUserContext>[0];

// Defined once so a re-render reconciles the same instance instead of remounting.
function Probe() {
    result = useDashboardUserContext(probeOptions);
    return null;
}

describe('useDashboardUserContext', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    async function render() {
        await act(async () => {
            root.render(<Probe />);
        });
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        result = undefined;
        probeOptions = undefined;
        useAuthMock.mockReturnValue({ user: administrator, channels });
        // useChannel's activeChannel comes from a fragment with no `permissions` field.
        useChannelMock.mockReturnValue({ activeChannel: { id: 'ch-2', token: 'store', code: 'store' } });
        usePermissionsMock.mockReturnValue({ hasPermissions: () => true });
        useAdminCustomFieldsMock.mockReturnValue({ customFields: undefined, ready: true });
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
    });

    it('loads administrator custom fields by default', async () => {
        await render();

        expect(useAdminCustomFieldsMock).toHaveBeenCalledWith({ enabled: true });
    });

    it('passes the opt-out through so no request is made', async () => {
        probeOptions = { includeCustomFields: false };

        await render();

        expect(useAdminCustomFieldsMock).toHaveBeenCalledWith({ enabled: false });
    });

    it('composes the administrator and their roles', async () => {
        await render();

        expect(result?.ctx.administrator?.id).toBe('admin-1');
        expect(result?.ctx.roles.map(role => role.code)).toEqual(['floor-staff']);
    });

    it('resolves the active channel against the permission-bearing list', async () => {
        // useChannel().activeChannel carries no permissions, so returning it directly
        // would hand predicates a channel with no permissions array.
        await render();

        expect(result?.ctx.activeChannel).toEqual({
            id: 'ch-2',
            token: 'store',
            code: 'store',
            permissions: ['ReadOrder'],
        });
    });

    it('leaves activeChannel undefined when it is not in the accessible list', async () => {
        useChannelMock.mockReturnValue({ activeChannel: { id: 'ch-unknown' } });

        await render();

        expect(result?.ctx.activeChannel).toBeUndefined();
    });

    it('merges administrator custom fields once they have loaded', async () => {
        useAdminCustomFieldsMock.mockReturnValue({
            customFields: { isFloorStaff: true },
            ready: true,
        });

        await render();

        expect(result?.ctx.administrator?.customFields).toEqual({ isFloorStaff: true });
    });

    it('reports not ready while custom fields are still loading', async () => {
        useAdminCustomFieldsMock.mockReturnValue({ customFields: undefined, ready: false });

        await render();

        expect(result?.ready).toBe(false);
        expect(result?.ctx.administrator?.customFields).toBeUndefined();
    });

    it('returns an empty context when logged out', async () => {
        useAuthMock.mockReturnValue({ user: undefined, channels: undefined });
        useChannelMock.mockReturnValue({ activeChannel: undefined });

        await render();

        expect(result?.ctx.administrator).toBeUndefined();
        expect(result?.ctx.roles).toEqual([]);
        expect(result?.ctx.channels).toEqual([]);
    });

    it('keeps the context reference stable across re-renders with unchanged inputs', async () => {
        // Every visibility rule re-runs when the context identity changes.
        await render();
        const first = result?.ctx;

        await render();

        expect(result?.ctx).toBe(first);
    });
});
