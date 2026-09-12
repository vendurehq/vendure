import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LS_KEY_USER_SETTINGS } from '@/vdb/constants.js';

import {
    UserSettings,
    UserSettingsContext,
    UserSettingsContextType,
    UserSettingsProvider,
} from './user-settings.js';

const mocks = vi.hoisted(() => ({
    serverSettings: null as unknown,
    saved: [] as unknown[],
}));

vi.mock('../graphql/api.js', () => ({
    api: {
        query: () => Promise.resolve({ getSettingsStoreValue: mocks.serverSettings }),
        mutate: (_doc: unknown, variables: any) => {
            mocks.saved.push(variables.input.value);
            return Promise.resolve({ setSettingsStoreValue: { result: 'UPDATED' } });
        },
    },
}));

/**
 * `tableSettings[pageId].columnFilters` uses `null` to mean "the user cleared every filter
 * on this page", as distinct from an absent value and from the `[]` written by dashboard
 * versions that saved the filter state on mount. See `ListPage`'s `resolveColumnFilters`.
 *
 * Both persistence paths have to carry that value through unchanged — `null` survives
 * `JSON.stringify` in a way that a deleted key or `undefined` would not, which is why the
 * sentinel is a value rather than an absence.
 */
describe('UserSettingsProvider cleared column filters', () => {
    let container: HTMLDivElement;
    let root: Root;
    let latest: UserSettingsContextType | undefined;

    function Probe() {
        latest = React.useContext(UserSettingsContext);
        return null;
    }

    async function renderProvider() {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <UserSettingsProvider>
                        <Probe />
                    </UserSettingsProvider>
                </QueryClientProvider>,
            );
        });
        // Let the settings query resolve and the resulting save effect run.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }

    function readLocalStorageSettings(): UserSettings {
        return JSON.parse(localStorage.getItem(LS_KEY_USER_SETTINGS) || '{}');
    }

    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        mocks.serverSettings = null;
        mocks.saved = [];
        latest = undefined;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('carries a null columnFilters through from localStorage', async () => {
        localStorage.setItem(
            LS_KEY_USER_SETTINGS,
            JSON.stringify({ tableSettings: { 'product-list': { columnFilters: null, pageSize: 25 } } }),
        );

        await renderProvider();

        expect(latest?.settings.tableSettings?.['product-list']).toEqual({
            columnFilters: null,
            pageSize: 25,
        });
    });

    it('carries a null columnFilters through from the server payload', async () => {
        // The server copy replaces the local one wholesale once it arrives, so it has to
        // preserve the sentinel just as the local seed does.
        mocks.serverSettings = {
            tableSettings: { 'product-list': { columnFilters: null, pageSize: 50 } },
        };

        await renderProvider();

        expect(latest?.settings.tableSettings?.['product-list']).toEqual({
            columnFilters: null,
            pageSize: 50,
        });
        // Nothing changed, so nothing was written back.
        expect(mocks.saved).toHaveLength(0);
    });

    it('persists a null columnFilters written through setTableSettings', async () => {
        await renderProvider();

        await act(async () => {
            latest?.setTableSettings('product-list', 'columnFilters', null);
        });
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(readLocalStorageSettings().tableSettings?.['product-list']).toEqual({
            columnFilters: null,
        });
        const lastSaved = mocks.saved.at(-1) as UserSettings | undefined;
        expect(lastSaved?.tableSettings?.['product-list']).toEqual({ columnFilters: null });
    });
});
