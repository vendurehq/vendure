import { getNavMenuConfig, setNavMenuConfig } from '../nav-menu/nav-menu-extensions.js';
import { globalRegistry } from '../registry/global-registry.js';

import { DashboardExtension } from './extension-api-types.js';
import {
    registerAlertExtensions,
    registerDataTableExtensions,
    registerDetailFormExtensions,
    registerFormComponentExtensions,
    registerHistoryEntryComponents,
    registerLayoutExtensions,
    registerLoginExtensions,
    registerNavigationExtensions,
    registerToolbarExtensions,
    registerWidgetExtensions,
} from './logic/index.js';

globalRegistry.register('extensionSourceChangeCallbacks', new Set<() => void>());
globalRegistry.register('registerDashboardExtensionCallbacks', new Set<() => void>());
globalRegistry.register('navMenuModifiers', []);

export function onExtensionSourceChange(callback: () => void) {
    globalRegistry.get('extensionSourceChangeCallbacks').add(callback);
}

export function executeDashboardExtensionCallbacks() {
    // Phase 1: Register all extensions (array-form navSections, routes, etc.)
    // Note: Phase 1 callbacks may push function-form modifiers into 'navMenuModifiers'
    // as a side effect, which Phase 2 then consumes.
    for (const callback of globalRegistry.get('registerDashboardExtensionCallbacks') ?? []) {
        callback();
    }

    // Phase 2: Apply nav menu modifier functions (function-form navSections)
    const modifiers = globalRegistry.get('navMenuModifiers');
    if (modifiers?.length) {
        let config = getNavMenuConfig();
        for (const modifier of modifiers) {
            const result = modifier(config);
            if (result && typeof result === 'object' && Array.isArray(result.sections)) {
                config = result;
            } else {
                // eslint-disable-next-line no-console
                console.warn(
                    `A navSections modifier function returned an invalid result. ` +
                        `Expected an object with a "sections" array. The modifier will be skipped. ` +
                        `Got: ${JSON.stringify(result)}`,
                );
            }
        }
        setNavMenuConfig(config);
    }
}

/**
 * @description
 * The main entry point for extensions to the React-based dashboard. Every dashboard extension
 * must contain a call to this function, usually in the entry point file that is referenced by
 * the `dashboard` property of the plugin decorator.
 *
 * Every type of customisation of the dashboard can be defined here, including:
 *
 * - Navigation (nav sections and routes)
 * - Layout (action bar items and page blocks)
 * - Widgets
 * - Form components (custom form components, input components, and display components)
 * - Data tables
 * - Detail forms
 * - Login
 * - Custom history entries
 * - Toolbar items
 *
 * @example
 * ```tsx
 * defineDashboardExtension({
 *  navSections: [],
 *  routes: [],
 *  pageBlocks: [],
 *  actionBarItems: [],
 * });
 * ```
 *
 *
 * @docsCategory extensions-api
 * @docsPage defineDashboardExtension
 * @docsWeight 0
 * @since 3.3.0
 */
export function defineDashboardExtension(extension: DashboardExtension) {
    globalRegistry.get('registerDashboardExtensionCallbacks').add(() => {
        // Register navigation extensions (nav sections and routes)
        const navMenuModifier = registerNavigationExtensions(extension.navSections, extension.routes);
        if (navMenuModifier) {
            globalRegistry.get('navMenuModifiers').push(navMenuModifier);
        }

        // Register layout extensions (action bar items and page blocks)
        registerLayoutExtensions(extension.actionBarItems, extension.pageBlocks);

        // Register widget extensions
        registerWidgetExtensions(extension.widgets);

        // Register form component extensions (custom form components, input components, and display components)
        registerFormComponentExtensions(extension.customFormComponents);

        // Register data table extensions
        registerDataTableExtensions(extension.dataTables);

        // Register detail form extensions
        registerDetailFormExtensions(extension.detailForms);

        // Register alert extensions
        registerAlertExtensions(extension.alerts);

        // Register login extensions
        registerLoginExtensions(extension.login);

        // Register custom history entry components
        registerHistoryEntryComponents(extension.historyEntries);

        // Register toolbar extensions
        registerToolbarExtensions(extension.toolbarItems);

        // Execute extension source change callbacks
        const callbacks = globalRegistry.get('extensionSourceChangeCallbacks');
        if (callbacks.size) {
            for (const callback of callbacks) {
                callback();
            }
        }
    });
}
