import { globalRegistry } from '@/vdb/framework/registry/global-registry.js';
import { ComponentType, createElement, ReactNode, useMemo } from 'react';

import { useDashboardExtensions } from './use-dashboard-extensions.js';

/**
 * @description
 * Allows you to define custom React providers that wrap selected parts of the dashboard UI.
 * This is useful for cross-cutting concerns such as custom context, error boundaries,
 * feature flags, telemetry, or theming.
 *
 * Providers can be mounted at either the application root (`'app'`) or the authenticated
 * layout main content area (`'layout'`, i.e. the `<Outlet />` subtree only; sidebar and
 * header are outside this wrapper).
 *
 * @docsCategory extensions-api
 * @docsPage Custom Providers
 * @since 3.7.0
 */
export type DashboardCustomProviderDefinition = {
    /**
     * @description
     * A unique identifier for this custom provider.
     */
    id: string;
    /**
     * @description
     * The React provider component to render. It receives `children` and should
     * return a wrapped subtree.
     */
    component: ComponentType<{ children: ReactNode }>;
    /**
     * @description
     * Optional. Controls render order relative to other providers at the same location.
     * Lower numbers render first (outermost), higher numbers render later (innermost).
     */
    order?: number;
    /**
     * @description
     * Determines where this provider is mounted in the dashboard hierarchy.
     *
     * - `'app'`: Wraps the entire dashboard application at the root level.
     * - `'layout'`: Wraps the main content area of the authenticated layout (the `<Outlet />` subtree).
     *
     * The sidebar and header are outside this wrapper.
     *
     * Optional. Defaults to 'app' if not specified.
     */
    location?: 'app' | 'layout';
};

globalRegistry.register(
    'dashboardCustomProvidersRegistry',
    new Map<string, DashboardCustomProviderDefinition>(),
);

export function getDashboardCustomProvidersRegistry() {
    return globalRegistry.get('dashboardCustomProvidersRegistry');
}

export function registerDashboardCustomProvider(customProvider: DashboardCustomProviderDefinition) {
    globalRegistry.set('dashboardCustomProvidersRegistry', map => {
        map.set(customProvider.id, {
            ...customProvider,
            location: customProvider.location ?? 'app',
        });
        return map;
    });
}

export function registerDashboardCustomProviders(providers: DashboardCustomProviderDefinition[] | undefined) {
    if (!providers?.length) {
        return;
    }
    const registry = getDashboardCustomProvidersRegistry();
    const allIds = [...registry.keys(), ...providers.map(p => p.id)];
    const seen = new Set<string>();
    const duplicateIds = new Set<string>();
    for (const id of allIds) {
        if (seen.has(id)) {
            duplicateIds.add(id);
        } else {
            seen.add(id);
        }
    }

    if (duplicateIds.size) {
        const duplicates = Array.from(duplicateIds).sort();
        throw new Error(
            `Duplicate dashboard custom provider ids detected: ` +
                `${duplicates.map(id => `"${id}"`).join(', ')}. ` +
                `Provider ids must be globally unique.`,
        );
    }

    for (const provider of providers) {
        registerDashboardCustomProvider(provider);
    }
}

export const renderProviders = (
    providers: DashboardCustomProviderDefinition[],
    children: ReactNode,
): ReactNode => {
    if (providers.length === 0) {
        return children;
    }

    const [currentProvider, ...remainingProviders] = providers;
    const ProviderComponent = currentProvider.component;

    return createElement(ProviderComponent, null, renderProviders(remainingProviders, children));
};

export interface CustomProvidersProps {
    location: DashboardCustomProviderDefinition['location'];
    children: ReactNode;
}

export function CustomProviders({ location, children }: Readonly<CustomProvidersProps>) {
    const { extensionsLoaded, reloadCount } = useDashboardExtensions();
    const providersToRender = useMemo(() => {
        const customProviders = Array.from(getDashboardCustomProvidersRegistry().values());
        return customProviders
            .filter(provider => provider.location === location)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [extensionsLoaded, reloadCount, location]);

    return renderProviders(providersToRender, children);
}
