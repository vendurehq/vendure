import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_STORE_KEY_USER_SETTINGS } from '../storage-keys.js';
import { UserSettingsContext, type UserSettingsContextType, UserSettingsProvider } from './user-settings.js';

const apiMock = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn() }));

vi.mock('../graphql/api.js', () => ({ api: apiMock }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function graphQLError(message: string, code?: string) {
    return Object.assign(new Error(message), code ? { extensions: { code } } : {});
}

const forbiddenError = () =>
    graphQLError('You are not currently authorized to perform this action', 'FORBIDDEN');

describe('UserSettingsProvider', () => {
    let container: HTMLDivElement;
    let root: Root;
    let queryClient: QueryClient;
    let context: UserSettingsContextType;

    function Probe() {
        context = useContext(UserSettingsContext)!;
        return null;
    }

    async function flush() {
        for (let i = 0; i < 5; i++) {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
        }
    }

    async function render() {
        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <UserSettingsProvider queryClient={queryClient}>
                        <Probe />
                    </UserSettingsProvider>
                </QueryClientProvider>,
            );
        });
        await flush();
    }

    function savedValues() {
        return apiMock.mutate.mock.calls.map(([, variables]) => variables.input.value);
    }

    beforeEach(() => {
        localStorage.clear();
        apiMock.query.mockReset();
        apiMock.mutate.mockReset();
        apiMock.mutate.mockResolvedValue({ setSettingsStoreValue: { result: true } });
        queryClient = new QueryClient();
        container = document.createElement('div');
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        queryClient.clear();
    });

    it('initializes from the stored value and saves changes on top of it', async () => {
        apiMock.query.mockResolvedValue({ getSettingsStoreValue: { displayLanguage: 'de' } });
        await render();

        expect(context.settingsReady).toBe(true);
        expect(context.settings.displayLanguage).toBe('de');

        await act(async () => context.setActiveChannelId('1'));
        await flush();
        expect(savedValues()).toEqual([
            expect.objectContaining({ displayLanguage: 'de', activeChannelId: '1' }),
        ]);
    });

    // #5595 — a FORBIDDEN read (no session yet) must not initialize the settings, and the
    // authenticated re-read after the login must initialize them from the stored value
    it('does not initialize on a FORBIDDEN read and initializes from the read after login', async () => {
        apiMock.query.mockRejectedValue(forbiddenError());
        await render();

        expect(context.settingsReady).toBe(false);
        // The login sets the active channel before it invalidates the queries
        await act(async () => context.setActiveChannelId('1'));
        await flush();
        expect(apiMock.mutate).not.toHaveBeenCalled();

        apiMock.query.mockResolvedValue({
            getSettingsStoreValue: { displayLanguage: 'de', tableSettings: { products: { pageSize: 37 } } },
        });
        await act(async () => queryClient.invalidateQueries());
        await flush();

        expect(context.settingsReady).toBe(true);
        expect(context.settings.displayLanguage).toBe('de');
        expect(context.settings.tableSettings).toEqual({ products: { pageSize: 37 } });
        // The stored value has no active channel, so it replaces the one which the login set
        expect(context.settings.activeChannelId).toBe('');
        expect(apiMock.mutate).not.toHaveBeenCalled();

        // Stands in for the "Set active channel if needed" effect in AuthProvider
        await act(async () => context.setActiveChannelId('1'));
        await flush();
        expect(savedValues()).toEqual([
            expect.objectContaining({
                displayLanguage: 'de',
                activeChannelId: '1',
                tableSettings: { products: { pageSize: 37 } },
            }),
        ]);
    });

    it('uses the local settings when the read after login finds no stored value', async () => {
        apiMock.query.mockRejectedValue(forbiddenError());
        await render();
        expect(context.settingsReady).toBe(false);

        apiMock.query.mockResolvedValue({ getSettingsStoreValue: null });
        await act(async () => queryClient.invalidateQueries());
        await flush();

        expect(context.settingsReady).toBe(true);
        expect(apiMock.mutate).not.toHaveBeenCalled();

        const localSettings = context.settings;
        await act(async () => context.setTheme('dark'));
        await flush();
        expect(savedValues()).toEqual([{ ...localSettings, theme: 'dark' }]);
    });

    it('becomes ready on a failed read without saving the local copy', async () => {
        apiMock.query.mockRejectedValue(graphQLError('Network request failed'));
        await render();

        expect(context.settingsReady).toBe(true);
        await act(async () => context.setTheme('dark'));
        await flush();
        expect(apiMock.mutate).not.toHaveBeenCalled();
    });

    it('initializes from a successful read that follows a failed read', async () => {
        apiMock.query.mockRejectedValue(graphQLError('Network request failed'));
        await render();
        expect(context.settingsReady).toBe(true);

        apiMock.query.mockResolvedValue({ getSettingsStoreValue: { displayLanguage: 'de' } });
        await act(async () => queryClient.invalidateQueries());
        await flush();
        expect(context.settings.displayLanguage).toBe('de');

        await act(async () => context.setTheme('dark'));
        await flush();
        expect(savedValues()).toEqual([expect.objectContaining({ displayLanguage: 'de', theme: 'dark' })]);
    });

    it('does not initialize on an UNAUTHORIZED read', async () => {
        apiMock.query.mockRejectedValue(graphQLError('Unauthorized', 'UNAUTHORIZED'));
        await render();

        expect(context.settingsReady).toBe(false);
        await act(async () => context.setTheme('dark'));
        await flush();
        expect(apiMock.mutate).not.toHaveBeenCalled();
    });

    it('becomes ready when the settings store field is not registered', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        apiMock.query.mockRejectedValue(
            graphQLError(`Settings store field not registered: ${SETTINGS_STORE_KEY_USER_SETTINGS}`),
        );
        await render();

        expect(context.settingsReady).toBe(true);
        expect(context.settingsStoreIsAvailable).toBe(false);
        await act(async () => context.setTheme('dark'));
        await flush();
        expect(apiMock.mutate).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});
