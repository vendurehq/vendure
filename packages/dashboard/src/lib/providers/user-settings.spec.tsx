import { setupI18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { keepPreviousData, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_STORE_KEY_USER_SETTINGS } from '../storage-keys.js';
import { AuthContext, AuthProvider } from './auth.js';
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
        queryClient = new QueryClient({ defaultOptions: { queries: { placeholderData: keepPreviousData } } });
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

    it('initializes from the next session after the previous session ended', async () => {
        apiMock.query.mockResolvedValue({ getSettingsStoreValue: { displayLanguage: 'de', theme: 'dark' } });
        await render();
        expect(context.settings.displayLanguage).toBe('de');

        apiMock.query.mockRejectedValue(forbiddenError());
        await act(async () => {
            queryClient.clear();
            context.resetServerSettings?.();
        });
        await flush();
        expect(context.settingsReady).toBe(false);

        await act(async () => context.setActiveChannelId('2'));
        await flush();
        expect(apiMock.mutate).not.toHaveBeenCalled();

        apiMock.query.mockResolvedValue({
            getSettingsStoreValue: { displayLanguage: 'fr', tableSettings: { products: { pageSize: 37 } } },
        });
        await act(async () => queryClient.invalidateQueries());
        await flush();

        expect(context.settingsReady).toBe(true);
        expect(context.settings.displayLanguage).toBe('fr');
        expect(context.settings.theme).toBe('system');
        expect(context.settings.tableSettings).toEqual({ products: { pageSize: 37 } });
        expect(apiMock.mutate).not.toHaveBeenCalled();
    });

    it('does not restore the previous session when its last save completes after the reset', async () => {
        apiMock.query.mockResolvedValue({ getSettingsStoreValue: { displayLanguage: 'de' } });
        await render();

        let finishSave: (value: unknown) => void = () => undefined;
        apiMock.mutate.mockReturnValue(new Promise(resolve => (finishSave = resolve)));
        await act(async () => context.setTheme('dark'));
        await flush();
        expect(apiMock.mutate).toHaveBeenCalledTimes(1);

        apiMock.query.mockRejectedValue(forbiddenError());
        await act(async () => {
            queryClient.clear();
            context.resetServerSettings?.();
        });
        await flush();
        await act(async () => finishSave({ setSettingsStoreValue: { result: true } }));
        await flush();

        apiMock.query.mockResolvedValue({ getSettingsStoreValue: { displayLanguage: 'fr' } });
        await act(async () => queryClient.invalidateQueries());
        await flush();

        expect(context.settings.displayLanguage).toBe('fr');
        expect(apiMock.mutate).toHaveBeenCalledTimes(1);
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

// #5646: logging out and signing in as another administrator without a reload must
// initialize the settings from the new administrator's stored value
describe('UserSettingsProvider with AuthProvider', () => {
    let container: HTMLDivElement;
    let root: Root;
    let queryClient: QueryClient;
    let settingsContext: UserSettingsContextType;
    let authContext: AuthContext;
    let session: 'first' | 'second' | 'third' | null;
    let stores: Record<'first' | 'second' | 'third', Record<string, any> | null>;
    const channels = {
        first: { id: '1', token: 'first-token' },
        second: { id: '2', token: 'second-token' },
        third: { id: '3', token: 'third-token' },
    };

    function Probe() {
        settingsContext = useContext(UserSettingsContext)!;
        authContext = useContext(AuthContext)!;
        return null;
    }

    async function flush() {
        for (let i = 0; i < 10; i++) {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
        }
    }

    const operationName = (document: any) => document?.definitions?.[0]?.name?.value;

    function handleMutation(document: any, variables: any) {
        switch (operationName(document)) {
            case 'Login':
                session = variables.username;
                return Promise.resolve({
                    login: { __typename: 'CurrentUser', id: '1', identifier: session },
                });
            case 'LogOut':
                session = null;
                return Promise.resolve({ logout: { success: true } });
            default:
                if (session) {
                    stores[session] = variables.input.value;
                }
                return Promise.resolve({ setSettingsStoreValue: { result: true } });
        }
    }

    async function render() {
        await act(async () => {
            root.render(
                <I18nProvider i18n={setupI18n({ locale: 'en', messages: { en: {} } })}>
                    <QueryClientProvider client={queryClient}>
                        <UserSettingsProvider queryClient={queryClient}>
                            <AuthProvider>
                                <Probe />
                            </AuthProvider>
                        </UserSettingsProvider>
                    </QueryClientProvider>
                </I18nProvider>,
            );
        });
        await flush();
    }

    beforeEach(() => {
        localStorage.clear();
        session = 'first';
        stores = {
            first: { displayLanguage: 'de', tableSettings: { products: { pageSize: 11 } } },
            second: { displayLanguage: 'fr', tableSettings: { products: { pageSize: 37 } } },
            third: null,
        };
        apiMock.query.mockReset();
        apiMock.mutate.mockReset();
        apiMock.query.mockImplementation((document: any) => {
            const name = operationName(document);
            if (name === 'CurrentUserInformation') {
                return Promise.resolve(
                    session
                        ? {
                              me: {
                                  id: session,
                                  identifier: session,
                                  channels: [{ ...channels[session], code: session, permissions: [] }],
                              },
                              activeAdministrator: null,
                          }
                        : { me: null, activeAdministrator: null },
                );
            }
            if (name === 'GetSettingsStoreValue') {
                return session
                    ? Promise.resolve({ getSettingsStoreValue: stores[session] })
                    : Promise.reject(forbiddenError());
            }
            return Promise.resolve({ activeAdministrator: null });
        });
        apiMock.mutate.mockImplementation((document: any, variables?: any) =>
            variables === undefined
                ? (vars: any) => handleMutation(document, vars)
                : handleMutation(document, variables),
        );
        queryClient = new QueryClient({ defaultOptions: { queries: { placeholderData: keepPreviousData } } });
        container = document.createElement('div');
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        queryClient.clear();
    });

    it('initializes from the next administrator after logout and does not save the previous settings', async () => {
        await render();
        expect(authContext.status).toBe('authenticated');
        expect(settingsContext.settings.displayLanguage).toBe('de');

        await act(async () => authContext.logout());
        await flush();
        expect(authContext.status).toBe('unauthenticated');

        await act(async () => authContext.login('second', 'password'));
        await flush();
        expect(authContext.status).toBe('authenticated');

        expect(stores.second).toEqual(
            expect.objectContaining({ displayLanguage: 'fr', tableSettings: { products: { pageSize: 37 } } }),
        );
        expect(stores.first?.displayLanguage).toBe('de');
        expect(settingsContext.settings.displayLanguage).toBe('fr');
        expect(settingsContext.settings.tableSettings).toEqual({ products: { pageSize: 37 } });
    });

    it('starts from the default settings when the next administrator has no stored value', async () => {
        await render();
        expect(settingsContext.settings.displayLanguage).toBe('de');

        await act(async () => authContext.logout());
        await flush();
        await act(async () => authContext.login('third', 'password'));
        await flush();
        expect(authContext.status).toBe('authenticated');
        expect(settingsContext.settings.displayLanguage).toBe('en');
        expect(settingsContext.settings.tableSettings).toEqual({});

        await act(async () => settingsContext.setTheme('dark'));
        await flush();
        expect(stores.third).toEqual(
            expect.objectContaining({
                displayLanguage: 'en',
                theme: 'dark',
                activeChannelId: '3',
                tableSettings: {},
            }),
        );
    });
});
