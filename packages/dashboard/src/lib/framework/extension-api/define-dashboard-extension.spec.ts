import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getDashboardWidgetFilters,
    getDashboardWidgetRegistry,
    getExcludedDashboardWidgets,
    getVisibleDashboardWidgets,
    registerDashboardWidget,
} from '../dashboard-widget/widget-extensions.js';
import {
    addNavMenuSection,
    getNavMenuConfig,
    NavMenuConfig,
    setNavMenuConfig,
} from '../nav-menu/nav-menu-extensions.js';
import { globalRegistry } from '../registry/global-registry.js';

import { getDashboardCustomProvidersRegistry, renderProviders } from './custom-providers.js';
import {
    defineDashboardExtension,
    executeDashboardExtensionCallbacks,
} from './define-dashboard-extension.js';
import { DashboardWidgetDefinition } from './types/index.js';

function resetNavState() {
    setNavMenuConfig({ sections: [] });
    // Re-register fresh callback and modifier sets
    (globalRegistry as any).registry.set('registerDashboardExtensionCallbacks', new Set<() => void>());
    (globalRegistry as any).registry.set('navMenuModifiers', []);
}

function resetWidgetRegistry() {
    globalRegistry.set('dashboardWidgetRegistry', () => new Map<string, DashboardWidgetDefinition>());
    globalRegistry.set('excludedDashboardWidgets', () => new Set<string>());
    globalRegistry.set('dashboardWidgetFilterRegistry', () => new Map());
}

function resetInsightsState() {
    resetWidgetRegistry();
    (globalRegistry as any).registry.set('registerDashboardExtensionCallbacks', new Set<() => void>());
}

const DummyWidget = () => null;

function makeWidget(id: string): DashboardWidgetDefinition {
    return { id, name: id, component: DummyWidget, defaultSize: { w: 4, h: 3 } };
}

function resetCustomProvidersRegistry() {
    globalRegistry.set('dashboardCustomProvidersRegistry', () => new Map());
    (globalRegistry as any).registry.set('registerDashboardExtensionCallbacks', new Set<() => void>());
}

describe('defineDashboardExtension - navSections', () => {
    beforeEach(() => {
        resetNavState();
    });

    it('registers array-form navSections immediately in Phase 1', () => {
        defineDashboardExtension({
            navSections: [{ id: 'my-section', title: 'My Section' }],
        });

        executeDashboardExtensionCallbacks();

        const result = getNavMenuConfig();
        expect(result.sections).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'my-section', title: 'My Section' })]),
        );
    });

    it('registers a route navigation shortcut', () => {
        addNavMenuSection({ id: 'catalog', title: 'Catalog', items: [] });
        defineDashboardExtension({
            routes: [
                {
                    path: '/reviews',
                    navMenuItem: {
                        sectionId: 'catalog',
                        id: 'reviews',
                        title: 'Reviews',
                        shortcut: 'r',
                    },
                    component: () => null,
                },
            ],
        });

        executeDashboardExtensionCallbacks();

        const catalog = getNavMenuConfig().sections.find(section => section.id === 'catalog');
        expect(catalog && 'items' in catalog ? catalog.items : []).toContainEqual(
            expect.objectContaining({ id: 'reviews', shortcut: 'r' }),
        );
    });

    it('throws when extensions declare the same navigation shortcut in development', () => {
        addNavMenuSection({ id: 'catalog', title: 'Catalog', items: [] });
        for (const id of ['reviews', 'returns']) {
            defineDashboardExtension({
                routes: [
                    {
                        path: `/${id}`,
                        navMenuItem: {
                            sectionId: 'catalog',
                            id,
                            title: id,
                            shortcut: 'r',
                        },
                        component: () => null,
                    },
                ],
            });
        }

        expect(() => executeDashboardExtensionCallbacks()).toThrowError(
            'Navigation shortcut collision: G → R is declared by "reviews" and "returns"',
        );

        const catalog = getNavMenuConfig().sections.find(section => section.id === 'catalog');
        expect(catalog && 'items' in catalog ? catalog.items : []).toEqual([
            expect.objectContaining({ id: 'reviews', shortcut: undefined }),
            expect.objectContaining({ id: 'returns', shortcut: undefined }),
        ]);
    });

    it('defers function-form navSections to Phase 2', () => {
        defineDashboardExtension({
            navSections: [{ id: 'settings', title: 'Settings' }],
        });

        defineDashboardExtension({
            navSections: (navConfig: NavMenuConfig): NavMenuConfig => ({
                sections: navConfig.sections.map(s =>
                    s.id === 'settings' ? { ...s, title: 'Preferences' } : s,
                ),
            }),
        });

        executeDashboardExtensionCallbacks();

        const result = getNavMenuConfig();
        const settingsSection = result.sections.find(s => s.id === 'settings');
        expect(settingsSection).toBeDefined();
        expect(settingsSection?.title).toBe('Preferences');
    });

    it('function-form sees all array-form registrations regardless of order', () => {
        // Define the modifier BEFORE the array-form section
        defineDashboardExtension({
            navSections: (navConfig: NavMenuConfig): NavMenuConfig => ({
                sections: navConfig.sections.map(s =>
                    s.id === 'catalog' ? { ...s, title: 'Products & More' } : s,
                ),
            }),
        });

        defineDashboardExtension({
            navSections: [{ id: 'catalog', title: 'Catalog' }],
        });

        executeDashboardExtensionCallbacks();

        const result = getNavMenuConfig();
        const catalogSection = result.sections.find(s => s.id === 'catalog');
        expect(catalogSection).toBeDefined();
        expect(catalogSection?.title).toBe('Products & More');
    });

    it('composes multiple modifier functions in order', () => {
        addNavMenuSection({ id: 'settings', title: 'Settings', placement: 'bottom', order: 100, items: [] });

        defineDashboardExtension({
            navSections: (navConfig: NavMenuConfig): NavMenuConfig => ({
                sections: [
                    ...navConfig.sections,
                    { id: 'added-by-first', title: 'First', placement: 'top', order: 1 },
                ],
            }),
        });

        defineDashboardExtension({
            navSections: (navConfig: NavMenuConfig): NavMenuConfig => ({
                sections: [
                    ...navConfig.sections,
                    { id: 'added-by-second', title: 'Second', placement: 'top', order: 2 },
                ],
            }),
        });

        executeDashboardExtensionCallbacks();

        const result = getNavMenuConfig();
        const ids = result.sections.map(s => s.id);
        expect(ids).toContain('settings');
        expect(ids).toContain('added-by-first');
        expect(ids).toContain('added-by-second');
        // Second modifier should see the section added by the first
        expect(ids.indexOf('added-by-first')).toBeLessThan(ids.indexOf('added-by-second'));
    });

    it('skips modifier that returns invalid result and warns', () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            /* noop */
        });

        addNavMenuSection({ id: 'catalog', title: 'Catalog', placement: 'top', order: 1, items: [] });

        defineDashboardExtension({
            navSections: (() => undefined) as any,
        });

        executeDashboardExtensionCallbacks();

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('navSections modifier function returned an invalid result'),
        );

        // Original config should be preserved
        const result = getNavMenuConfig();
        expect(result.sections.find(s => s.id === 'catalog')).toBeDefined();

        warnSpy.mockRestore();
    });

    it('skips modifier that returns non-array sections and warns', () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            /* noop */
        });

        addNavMenuSection({ id: 'catalog', title: 'Catalog', placement: 'top', order: 1, items: [] });

        defineDashboardExtension({
            navSections: (() => ({ sections: 'not-an-array' })) as any,
        });

        executeDashboardExtensionCallbacks();

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('navSections modifier function returned an invalid result'),
        );

        const result = getNavMenuConfig();
        expect(result.sections.find(s => s.id === 'catalog')).toBeDefined();

        warnSpy.mockRestore();
    });

    it('can move items between sections', () => {
        addNavMenuSection({
            id: 'settings',
            title: 'Settings',
            placement: 'bottom',
            order: 100,
            items: [
                { id: 'administrators', title: 'Administrators', url: '/administrators' },
                { id: 'roles', title: 'Roles', url: '/roles' },
                { id: 'channels', title: 'Channels', url: '/channels' },
            ],
        });

        const idsToMove = ['administrators', 'roles'];

        defineDashboardExtension({
            navSections: (navConfig: NavMenuConfig): NavMenuConfig => {
                const existingSettings = navConfig.sections.find(s => s.id === 'settings');
                const existingItems =
                    existingSettings && 'items' in existingSettings ? (existingSettings.items ?? []) : [];

                return {
                    sections: [
                        ...navConfig.sections.map(section =>
                            section.id === 'settings' && 'items' in section
                                ? { ...section, items: section.items?.filter(i => !idsToMove.includes(i.id)) }
                                : section,
                        ),
                        {
                            id: 'access',
                            title: 'Access & Identity',
                            placement: 'bottom' as const,
                            order: 150,
                            items: existingItems.filter(i => idsToMove.includes(i.id)),
                        },
                    ],
                };
            },
        });

        executeDashboardExtensionCallbacks();

        const result = getNavMenuConfig();
        const settingsSection = result.sections.find(s => s.id === 'settings');
        const accessSection = result.sections.find(s => s.id === 'access');

        // Settings should only have 'channels' left
        expect(settingsSection && 'items' in settingsSection ? settingsSection.items : []).toEqual([
            expect.objectContaining({ id: 'channels' }),
        ]);

        // Access should have the moved items
        expect(accessSection && 'items' in accessSection ? accessSection.items : []).toEqual([
            expect.objectContaining({ id: 'administrators' }),
            expect.objectContaining({ id: 'roles' }),
        ]);
    });
});

describe('DashboardWidgetDefinition - requiresPermissions', () => {
    beforeEach(() => {
        resetWidgetRegistry();
    });

    it('registers a widget without requiresPermissions', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'test-widget',
            name: 'Test Widget',
            component: DummyComponent,
            defaultSize: { w: 6, h: 3 },
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('test-widget');
        expect(widget).toBeDefined();
        expect(widget?.requiresPermissions).toBeUndefined();
    });

    it('registers a widget with requiresPermissions and preserves the value', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'restricted-widget',
            name: 'Restricted Widget',
            component: DummyComponent,
            defaultSize: { w: 6, h: 3 },
            requiresPermissions: ['ReadOrder'],
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('restricted-widget');
        expect(widget).toBeDefined();
        expect(widget?.requiresPermissions).toEqual(['ReadOrder']);
    });

    it('supports multiple permissions', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'multi-perm-widget',
            name: 'Multi Permission Widget',
            component: DummyComponent,
            defaultSize: { w: 4, h: 2 },
            requiresPermissions: ['ReadOrder', 'ReadCatalog'],
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('multi-perm-widget');
        expect(widget?.requiresPermissions).toEqual(['ReadOrder', 'ReadCatalog']);
    });

    it('preserves the defaultConfig value', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'config-widget',
            name: 'Config Widget',
            component: DummyComponent,
            defaultSize: { w: 6, h: 3 },
            defaultConfig: { dataType: 'OrderTotal' },
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('config-widget');
        expect(widget?.defaultConfig).toEqual({ dataType: 'OrderTotal' });
    });

    it('defaults allowMultipleInstances to undefined when not set', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'single-instance-widget',
            name: 'Single Instance Widget',
            component: DummyComponent,
            defaultSize: { w: 6, h: 3 },
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('single-instance-widget');
        expect(widget?.allowMultipleInstances).toBeUndefined();
    });

    it('preserves the allowMultipleInstances flag', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'multi-instance-widget',
            name: 'Multi Instance Widget',
            component: DummyComponent,
            defaultSize: { w: 6, h: 3 },
            allowMultipleInstances: true,
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('multi-instance-widget');
        expect(widget?.allowMultipleInstances).toBe(true);
    });

    it('preserves an empty requiresPermissions array (public widget)', () => {
        const DummyComponent = () => null;
        registerDashboardWidget({
            id: 'empty-perm-widget',
            name: 'Empty Perm Widget',
            component: DummyComponent,
            defaultSize: { w: 6, h: 3 },
            requiresPermissions: [],
        });

        const registry = getDashboardWidgetRegistry();
        const widget = registry.get('empty-perm-widget');
        expect(widget).toBeDefined();
        expect(widget?.requiresPermissions).toEqual([]);
    });
});

describe('defineDashboardExtension - insights', () => {
    beforeEach(() => {
        resetInsightsState();
    });

    it('registers widgets via insights.widgets', () => {
        defineDashboardExtension({
            insights: { widgets: [makeWidget('insights-widget')] },
        });
        executeDashboardExtensionCallbacks();

        expect(getDashboardWidgetRegistry().get('insights-widget')).toBeDefined();
    });

    it('still registers widgets via the deprecated top-level widgets option', () => {
        defineDashboardExtension({
            widgets: [makeWidget('legacy-widget')],
        });
        executeDashboardExtensionCallbacks();

        expect(getDashboardWidgetRegistry().get('legacy-widget')).toBeDefined();
    });

    it('merges deprecated top-level widgets with insights.widgets', () => {
        defineDashboardExtension({
            widgets: [makeWidget('legacy-widget')],
            insights: { widgets: [makeWidget('insights-widget')] },
        });
        executeDashboardExtensionCallbacks();

        expect(getDashboardWidgetRegistry().get('legacy-widget')).toBeDefined();
        expect(getDashboardWidgetRegistry().get('insights-widget')).toBeDefined();
    });

    it('excludeWidgets removes a widget from the visible registry', () => {
        registerDashboardWidget(makeWidget('latest-orders-widget'));
        registerDashboardWidget(makeWidget('metrics-widget'));

        defineDashboardExtension({
            insights: { excludeWidgets: ['latest-orders-widget'] },
        });
        executeDashboardExtensionCallbacks();

        const visibleIds = getVisibleDashboardWidgets().map(([id]) => id);
        expect(visibleIds).toContain('metrics-widget');
        expect(visibleIds).not.toContain('latest-orders-widget');
        // The definition remains in the raw registry; only the effective/visible set removes it.
        expect(getExcludedDashboardWidgets().has('latest-orders-widget')).toBe(true);
    });

    it('excludes a widget registered by another extension regardless of order', () => {
        defineDashboardExtension({
            insights: { excludeWidgets: ['other-extension-widget'] },
        });
        defineDashboardExtension({
            insights: { widgets: [makeWidget('other-extension-widget')] },
        });
        executeDashboardExtensionCallbacks();

        const visibleIds = getVisibleDashboardWidgets().map(([id]) => id);
        expect(getDashboardWidgetRegistry().get('other-extension-widget')).toBeDefined();
        expect(visibleIds).not.toContain('other-extension-widget');
    });

    it('registers a global filter via insights.filters', () => {
        defineDashboardExtension({
            insights: {
                filters: [{ id: 'warehouse', component: DummyWidget, defaultValue: 'all' }],
            },
        });
        executeDashboardExtensionCallbacks();

        const filters = getDashboardWidgetFilters();
        expect(filters).toHaveLength(1);
        expect(filters[0]).toMatchObject({ id: 'warehouse', defaultValue: 'all' });
    });

    it('registers filters from multiple extensions without collisions', () => {
        defineDashboardExtension({
            insights: { filters: [{ id: 'warehouse', component: DummyWidget }] },
        });
        defineDashboardExtension({
            insights: { filters: [{ id: 'channel', component: DummyWidget }] },
        });
        executeDashboardExtensionCallbacks();

        expect(getDashboardWidgetFilters().map(f => f.id)).toEqual(['warehouse', 'channel']);
    });

    it('warns on a duplicate filter id and the last registration wins', () => {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
            /* noop */
        });

        const FirstComponent = () => null;
        const SecondComponent = () => null;
        defineDashboardExtension({
            insights: { filters: [{ id: 'warehouse', component: FirstComponent }] },
        });
        defineDashboardExtension({
            insights: { filters: [{ id: 'warehouse', component: SecondComponent }] },
        });
        executeDashboardExtensionCallbacks();

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                'A dashboard widget filter with the id "warehouse" is already registered',
            ),
        );
        const filters = getDashboardWidgetFilters();
        expect(filters).toHaveLength(1);
        // Last-wins, matching the widget registry.
        expect(filters[0].component).toBe(SecondComponent);

        warnSpy.mockRestore();
    });
});

describe('Dashboard custom providers', () => {
    beforeEach(() => {
        resetCustomProvidersRegistry();
    });

    it('renders providers recursively in nesting order', () => {
        const ProviderA = ({ children }: { children: React.ReactNode }) =>
            createElement('section', { 'data-provider': 'a' }, children);
        const ProviderB = ({ children }: { children: React.ReactNode }) =>
            createElement('section', { 'data-provider': 'b' }, children);

        const result = renderProviders(
            [
                { id: 'provider-a', component: ProviderA, location: 'app' },
                { id: 'provider-b', component: ProviderB, location: 'app' },
            ],
            createElement('div', { id: 'content' }, 'content'),
        );

        const html = renderToStaticMarkup(createElement('div', null, result));
        expect(html).toContain('<section data-provider="a"><section data-provider="b">');
        expect(html).toContain('<div id="content">content</div>');
    });

    it('registers providers sorted by order (ascending)', () => {
        const callOrder: string[] = [];

        const ProviderFirst = ({ children }: { children: React.ReactNode }) => {
            callOrder.push('first');
            return createElement('section', { 'data-provider': 'first' }, children);
        };
        const ProviderSecond = ({ children }: { children: React.ReactNode }) => {
            callOrder.push('second');
            return createElement('section', { 'data-provider': 'second' }, children);
        };

        defineDashboardExtension({
            customProviders: [
                { id: 'second', component: ProviderSecond, order: 20, location: 'app' },
                { id: 'first', component: ProviderFirst, order: 10, location: 'app' },
            ],
        });
        executeDashboardExtensionCallbacks();

        const providers = Array.from(getDashboardCustomProvidersRegistry().values()).sort(
            (a, b) => (a.order || 0) - (b.order || 0),
        );
        const tree = renderProviders(providers, createElement('div', null, 'leaf'));
        renderToStaticMarkup(createElement('div', null, tree));

        expect(callOrder).toEqual(['first', 'second']);
    });

    it('throws when duplicate custom provider ids are registered', () => {
        const Provider = ({ children }: { children: React.ReactNode }) => children;

        defineDashboardExtension({
            customProviders: [{ id: 'duplicate-provider', component: Provider }],
        });
        defineDashboardExtension({
            customProviders: [{ id: 'duplicate-provider', component: Provider }],
        });

        expect(() => executeDashboardExtensionCallbacks()).toThrow(
            'Duplicate dashboard custom provider ids detected: "duplicate-provider". Provider ids must be globally unique.',
        );
    });
});
