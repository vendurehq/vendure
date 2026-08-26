import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useServerConfigMock = vi.hoisted(() => vi.fn());
const useAuthMock = vi.hoisted(() => vi.fn());
const apiQueryMock = vi.hoisted(() => vi.fn());
const getCustomFieldsMapMock = vi.hoisted(() => vi.fn());
const addCustomFieldsMock = vi.hoisted(() => vi.fn((document: unknown) => document));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/vdb/hooks/use-server-config.js', () => ({ useServerConfig: useServerConfigMock }));
vi.mock('@/vdb/hooks/use-auth.js', () => ({ useAuth: useAuthMock }));
vi.mock('@/vdb/graphql/api.js', () => ({ api: { query: apiQueryMock } }));
vi.mock('@/vdb/framework/document-introspection/add-custom-fields.js', () => ({
    addCustomFields: addCustomFieldsMock,
    getCustomFieldsMap: getCustomFieldsMapMock,
}));

import { useAdminCustomFields } from './use-admin-custom-fields.js';

type HookResult = ReturnType<typeof useAdminCustomFields>;

describe('useAdminCustomFields', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let result: HookResult | undefined;

    async function render(options?: Parameters<typeof useAdminCustomFields>[0]) {
        function Probe() {
            result = useAdminCustomFields(options);
            return null;
        }
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
        });
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Probe />
                </QueryClientProvider>,
            );
        });
        // Let the query settle and re-render.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        result = undefined;
        getCustomFieldsMapMock.mockReturnValue(new Map());
        useServerConfigMock.mockReturnValue({ entityCustomFields: [] });
        useAuthMock.mockReturnValue({ user: { id: 'admin-1' } });
        apiQueryMock.mockResolvedValue({ activeAdministrator: { id: 'admin-1', customFields: {} } });
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        vi.clearAllMocks();
    });

    it('reports ready immediately when logged out, without querying', async () => {
        useAuthMock.mockReturnValue({ user: undefined });

        await render();

        expect(result?.ready).toBe(true);
        expect(result?.customFields).toBeUndefined();
        expect(apiQueryMock).not.toHaveBeenCalled();
    });

    it('is not ready while logged in but serverConfig has not resolved', async () => {
        useServerConfigMock.mockReturnValue(undefined);

        await render();

        // The map only fills once serverConfig lands, so ready here would let
        // predicates observe absent custom fields.
        expect(result?.ready).toBe(false);
        expect(apiQueryMock).not.toHaveBeenCalled();
    });

    it('does not query and reports ready when the caller opts out', async () => {
        // A dashboard with no isVisible predicate and no nav transform has nothing to
        // read the result, so the request must not be made at all.
        await render({ enabled: false });

        expect(result?.ready).toBe(true);
        expect(result?.customFields).toBeUndefined();
        expect(apiQueryMock).not.toHaveBeenCalled();
    });

    it('returns the custom fields once the query succeeds', async () => {
        apiQueryMock.mockResolvedValue({
            activeAdministrator: { id: 'admin-1', customFields: { isFloorStaff: true } },
        });

        await render();

        expect(result?.ready).toBe(true);
        expect(result?.customFields).toEqual({ isFloorStaff: true });
    });

    it('fails open when the query errors, rather than withholding readiness', async () => {
        apiQueryMock.mockRejectedValue(new Error('network down'));

        await render();

        expect(result?.ready).toBe(true);
        expect(result?.customFields).toBeUndefined();
    });

    it('returns undefined rather than throwing when the response carries no customFields', async () => {
        // No custom fields configured, so nothing is grafted onto the selection set.
        apiQueryMock.mockResolvedValue({ activeAdministrator: { id: 'admin-1' } });

        await render();

        expect(result?.ready).toBe(true);
        expect(result?.customFields).toBeUndefined();
    });

    it('returns undefined for a malformed response instead of passing it through', async () => {
        apiQueryMock.mockResolvedValue({ activeAdministrator: { id: 'admin-1', customFields: 'nonsense' } });

        await render();

        expect(result?.customFields).toBeUndefined();
    });

    it('builds the document from the populated custom fields map, not an empty one', async () => {
        // Deriving from the map's identity rather than serverConfig is what keeps this
        // correct regardless of main.tsx's effect ordering.
        const populated = new Map([['Administrator', [{ name: 'isFloorStaff', type: 'boolean' }]]]);
        getCustomFieldsMapMock.mockReturnValue(populated);

        await render();

        expect(addCustomFieldsMock).toHaveBeenCalledWith(expect.anything(), {
            customFieldsMap: populated,
        });
    });
});
