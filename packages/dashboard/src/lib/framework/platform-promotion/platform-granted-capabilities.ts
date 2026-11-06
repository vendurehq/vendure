import { globalRegistry } from '../registry/global-registry.js';

export interface PlatformGrantedCapabilitiesStore {
    capabilities: ReadonlySet<string> | undefined;
    listeners: Set<() => void>;
}

globalRegistry.register('platformGrantedCapabilities', {
    capabilities: undefined,
    listeners: new Set(),
});

/**
 * @description
 * Reports the Vendure Platform capability keys that the current license grants. The
 * Dashboard shows a locked item for each promoted Platform capability that is not in
 * this set. The License Guard Dashboard extension calls this function. Each call
 * replaces the earlier set.
 *
 * The Dashboard applies these rules:
 *
 * - The Vendure config has no `LicenseGuardPlugin`: the granted set is empty, and the
 *   Dashboard shows all locked items on the first render.
 * - The Vendure config has the `LicenseGuardPlugin` and this function was called: the
 *   Dashboard uses the reported set.
 * - The Vendure config has the `LicenseGuardPlugin` and this function was not called
 *   (yet): the Dashboard shows no locked items.
 *
 * Call it before the first render if you can, for example at the top level of the
 * extension entry file, or from a `customProviders` component that loads the grants.
 *
 * @example
 * ```ts
 * import { defineDashboardExtension, setPlatformGrantedCapabilities } from '@vendure/dashboard';
 *
 * setPlatformGrantedCapabilities(['org.accounts', 'quote.requests']);
 *
 * defineDashboardExtension({});
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage PlatformPromotion
 * @since 3.9.0
 */
export function setPlatformGrantedCapabilities(capabilities: readonly string[]) {
    const store = globalRegistry.get('platformGrantedCapabilities');
    store.capabilities = new Set(capabilities);
    for (const listener of store.listeners) {
        listener();
    }
}

/**
 * @description
 * Returns the capability keys that were reported with {@link setPlatformGrantedCapabilities},
 * or `undefined` if nothing was reported.
 *
 * @internal
 */
export function getReportedPlatformGrantedCapabilities(): ReadonlySet<string> | undefined {
    return globalRegistry.get('platformGrantedCapabilities').capabilities;
}

/**
 * @internal
 */
export function subscribeToPlatformGrantedCapabilities(listener: () => void): () => void {
    const { listeners } = globalRegistry.get('platformGrantedCapabilities');
    listeners.add(listener);
    return () => listeners.delete(listener);
}
