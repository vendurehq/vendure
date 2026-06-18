import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getDashboardWidgetRegistry,
    registerDashboardWidget,
} from '../dashboard-widget/widget-extensions.js';
import {
    addNavMenuSection,
    getNavMenuConfig,
    NavMenuConfig,
    setNavMenuConfig,
} from '../nav-menu/nav-menu-extensions.js';
import { globalRegistry } from '../registry/global-registry.js';

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
