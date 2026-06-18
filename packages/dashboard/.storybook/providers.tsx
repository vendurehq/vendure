import { api } from '@/vdb/graphql/api.js';
import {
    getSettingsStoreValueDocument,
    setSettingsStoreValueDocument,
} from '@/vdb/graphql/settings-store-operations.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { AuthProvider } from '@/vdb/providers/auth.js';
import { ChannelProvider } from '@/vdb/providers/channel-provider.js';
import { I18nProvider } from '@/vdb/providers/i18n-provider.js';
import { ThemeProvider } from '@/vdb/providers/theme-provider.js';
import { UserSettingsProvider } from '@/vdb/providers/user-settings.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    AnyRoute,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { PropsWithChildren, useEffect } from 'react';

// Initialize API mocks for Storybook
mockUserSettingsApi();

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5,
            networkMode: 'offlineFirst',
        },
    },
});

/**
 * These providers are required for all stories and are set in the preview.tsx file
 * @param children
 * @constructor
 */
export function CommonProviders({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            <UserSettingsProvider queryClient={queryClient}>
                <AuthProvider>
                    <DemoAuthProvider>
                        <I18nProvider>
                            <ThemeProvider defaultTheme="light">
                                <ChannelProvider>{children}</ChannelProvider>
                            </ThemeProvider>
                        </I18nProvider>
                    </DemoAuthProvider>
                </AuthProvider>
            </UserSettingsProvider>
        </QueryClientProvider>
    );
}

/**
 * Required by some stories that need a Tanstack Router Route object
 */
export function createDemoRoute(path?: string, initialPath?: string) {
    const rootRoute = createRootRoute();
    const route = createRoute({
        getParentRoute: () => rootRoute,
        path: path ?? 'test',
        component: () => <div>Test Route</div>,
        loader: () => ({ breadcrumb: 'Test' }),
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([route]),
        history: createMemoryHistory({
            initialEntries: [initialPath ?? '/test'],
        }),
    });
    return { route, router };
}

/**
 * A wrapper around components that need a Tanstack Router context
 */
export function DemoRouterProvider(props: {
    path?: string;
    initialPath?: string;
    component: (route: AnyRoute) => React.ReactNode;
}) {
    const rootRoute = createRootRoute();
    const route = createRoute({
        getParentRoute: () => rootRoute,
        path: props.path ?? 'test',
        component: () => props.component(route),
        loader: () => ({ breadcrumb: 'Test' }),
    });

    const router = createRouter({
        routeTree: rootRoute.addChildren([route]),
        history: createMemoryHistory({
            initialEntries: [props.initialPath ?? '/test'],
        }),
    });

    return <RouterProvider router={router} />;
}

/**
 * Provides a logged in superadmin user
 */
export function DemoAuthProvider({ children }: PropsWithChildren) {
    const { login, isAuthenticated } = useAuth();

    const username = import.meta.env.VITE_ADMIN_USERNAME ?? 'admin';
    const password = import.meta.env.VITE_ADMIN_PASSWORD ?? 'admin';

    useEffect(() => {
        if (!isAuthenticated) {
            login(username, password);
        }
    }, [isAuthenticated]);
    return children;
}

/**
 * Mocks the user settings API calls to prevent unnecessary network requests in Storybook.
 *
 * This function intercepts GraphQL queries and mutations for user settings by monkey-patching
 * the `api.query` and `api.mutate` functions. It provides instant mock responses for:
 *
 * 1. **GetSettingsStoreValue query**: Returns mock user settings data
 * 2. **SetSettingsStoreValue mutation**: Returns a mock success response
 *
 * All other GraphQL operations are passed through to the original implementation unchanged.
 *
 * @remarks
 * This is necessary because the UserSettingsProvider uses `staleTime: 0` in its useQuery,
 * which would cause the query to refetch on every story render. By mocking at the API level,
 * we avoid these unnecessary network calls while still allowing the provider to function
 * normally for demonstration purposes.
 */
function mockUserSettingsApi() {
    // Mock user settings data
    const mockUserSettings = {
        displayLanguage: 'en',
        contentLanguage: 'en',
        theme: 'system',
        displayUiExtensionPoints: false,
        mainNavExpanded: true,
        activeChannelId: '1',
        devMode: false,
        hasSeenOnboarding: false,
        tableSettings: {},
    };

    // Mock the query function to intercept GetSettingsStoreValue
    const originalQuery = api.query.bind(api);
    api.query = ((document: any, variables?: any) => {
        // Intercept the user settings query and return mock data immediately
        if (
            document === getSettingsStoreValueDocument &&
            variables?.key === 'vendure.dashboard.userSettings'
        ) {
            return Promise.resolve({ getSettingsStoreValue: mockUserSettings });
        }
        // Pass through all other queries to the original implementation
        return originalQuery(document, variables);
    }) as typeof api.query;

    // Mock the mutate function to intercept SetSettingsStoreValue
    const originalMutate = api.mutate.bind(api);
    api.mutate = ((document: any, variables?: any) => {
        // Intercept the user settings mutation and return mock success response
        if (
            document === setSettingsStoreValueDocument &&
            variables?.input?.key === 'vendure.dashboard.userSettings'
        ) {
            return Promise.resolve({
                setSettingsStoreValue: {
                    key: 'vendure.dashboard.userSettings',
                    result: true,
                    error: null,
                },
            });
        }
        // Pass through all other mutations to the original implementation
        return originalMutate(document, variables);
    }) as typeof api.mutate;
}
