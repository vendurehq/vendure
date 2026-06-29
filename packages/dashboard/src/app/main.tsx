import { Toaster } from '@/vdb/components/ui/sonner.js';
import { Spinner } from '@/vdb/components/ui/spinner.js';
import { registerDefaults } from '@/vdb/framework/defaults.js';
import {
    clearCustomFieldsMap,
    setCustomFieldsMap,
} from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { executeDashboardExtensionCallbacks } from '@/vdb/framework/extension-api/define-dashboard-extension.js';
import { useDashboardExtensions } from '@/vdb/framework/extension-api/use-dashboard-extensions.js';
import { useExtendedRouter } from '@/vdb/framework/page/use-extended-router.js';
import { useAuth } from '@/vdb/hooks/use-auth.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { defaultLocale, dynamicActivate } from '@/vdb/providers/i18n-provider.js';
import { AnyRoute, createRouter, RouterOptions, RouterProvider } from '@tanstack/react-router';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import ReactDOM from 'react-dom/client';

import { useDisplayLocale } from '@/vdb/hooks/use-display-locale.js';
import { useUiLanguageLoader } from '@/vdb/hooks/use-ui-language-loader.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { DirectionProvider } from '@/vdb/components/ui/direction.js';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AppProviders, queryClient } from './app-providers.js';
import { setDocumentDirection } from './common/set-document-direction.js';
import { routeTree } from './routeTree.gen.js';
import './styles.css';

const processedBaseUrl = (() => {
    const baseUrl = import.meta.env.BASE_URL;
    if (!baseUrl || baseUrl === '/') return undefined;
    // Ensure leading slash, remove trailing slash
    const normalized = baseUrl.startsWith('/') ? baseUrl : '/' + baseUrl;
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
})();

const routerOptions: RouterOptions<AnyRoute, any> = {
    defaultPreload: 'intent' as const,
    scrollRestoration: true,
    basepath: processedBaseUrl,
    // Wait a short moment before showing the pending UI on navigation, so
    // fast transitions (cached / preloaded routes) don't flash a spinner.
    // After 200ms the route hasn't resolved → show a non-jumpy fallback.
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    defaultPendingComponent: () => (
        <div
            className="flex items-center justify-center w-full text-muted-foreground"
            style={{ minHeight: '60vh' }}
            aria-busy="true"
        >
            <Spinner />
        </div>
    ),
    context: {
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        auth: undefined!, // This will be set after we wrap the app in an AuthProvider
        queryClient,
    },
    defaultErrorComponent: ({ error }: { error: Error }) => (
        <div className="text-destructive p-6">An error occurred: {error.message}</div>
    ),
};

// Create a type-only router instance for TypeScript type registration
// The actual runtime router is created in InnerApp component
const typeRouter = createRouter({
    ...routerOptions,
    routeTree,
});

// Register the router type for TypeScript
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof typeRouter;
    }
}

function InnerApp() {
    const auth = useAuth();
    const router = useExtendedRouter(routeTree, routerOptions);
    const serverConfig = useServerConfig();
    const { isRTL } = useDisplayLocale();
    const [hasSetCustomFieldsMap, setHasSetCustomFieldsMap] = React.useState(false);
    const { settings } = useUserSettings();
    const { loadAndActivateLocale } = useUiLanguageLoader();

    useEffect(() => {
        void loadAndActivateLocale(settings.displayLanguage);
    }, [settings.displayLanguage]);

    useEffect(() => {
        if (!serverConfig) {
            // serverConfig clears on logout. Reset the global map and the
            // local flag so a subsequent login as a different administrator
            // re-derives queries against fresh custom-field config rather
            // than reusing the previous user's map.
            clearCustomFieldsMap();
            setHasSetCustomFieldsMap(false);
            return;
        }
        setCustomFieldsMap(serverConfig.entityCustomFields);
        setHasSetCustomFieldsMap(true);
    }, [serverConfig]);

    useEffect(() => {
        setDocumentDirection(isRTL ? 'rtl' : 'ltr');
    }, [isRTL]);

    const isReady = hasSetCustomFieldsMap || auth.status === 'unauthenticated';
    return (
        <>
            <DirectionProvider direction={isRTL ? 'rtl' : 'ltr'}>
                {isReady ? (
                    <RouterProvider router={router} context={{ auth, queryClient }} />
                ) : (
                    <BootSplash />
                )}
                {settings.devMode ? <ReactQueryDevtools /> : null}
            </DirectionProvider>
        </>
    );
}

/**
 * Lightweight full-screen splash shown while auth + server config are still
 * resolving on cold load. Without this we render an empty document, which
 * makes the dashboard feel laggy on first paint.
 */
function BootSplash() {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-background">
            <Spinner className="text-muted-foreground" />
        </div>
    );
}

function App() {
    const [i18nLoaded, setI18nLoaded] = React.useState(false);
    const { extensionsLoaded } = useDashboardExtensions();
    useEffect(() => {
        // With this method we dynamically load the catalogs
        void dynamicActivate(defaultLocale, () => {
            setI18nLoaded(true);
        });
        registerDefaults();
    }, []);

    useEffect(() => {
        if (extensionsLoaded) {
            executeDashboardExtensionCallbacks();
        }
    }, [extensionsLoaded]);

    if (!i18nLoaded || !extensionsLoaded) {
        // Show a minimal full-screen splash so the user sees that the app is
        // loading rather than a white screen while i18n catalogs and dashboard
        // extensions resolve.
        return <BootSplash />;
    }
    return (
        <AppProviders>
            <InnerApp />
            {createPortal(<Toaster />, document.body)}
        </AppProviders>
    );
}

const rootElement = document.getElementById('app')!;

if (!rootElement.innerHTML) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>,
    );
}
