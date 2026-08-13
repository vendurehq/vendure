import type { VendureConfig } from '@vendure/core';

import { PluginInfo } from '../types.js';

/**
 * @description
 * Filters the statically discovered `pluginInfo` against the plugins actually
 * present in the runtime `VendureConfig.plugins` array.
 *
 * The dashboard's static-import-based plugin discovery walks the import graph
 * starting from `vendure-config.ts` and additionally expands `package.json`
 * `dependencies` of every imported package. That means it can find dashboard
 * extensions for plugins that are reachable through imports but are not
 * actually bootstrapped at runtime — e.g. when plugins are conditionally
 * included based on options, env vars or feature flags, or when a wrapper
 * package lists optional plugins as dependencies.
 *
 * Without this filter, those non-active plugins would still have their
 * dashboard extensions, translations and Tailwind sources bundled into the
 * built dashboard, while their server-side resolvers, GraphQL types and
 * services would be absent — leading to broken nav items and runtime
 * crashes inside the dashboard.
 *
 * Fails open: if `vendureConfig.plugins` is not an array (e.g. an unresolved
 * or malformed config), the discovered `pluginInfo` is returned unchanged
 * rather than stripping every extension. A missing `plugins` key means "no
 * filtering information", not "disable everything".
 *
 * @internal
 */
export function filterActivePluginInfo(
    pluginInfo: PluginInfo[],
    vendureConfig: Pick<VendureConfig, 'plugins'>,
): PluginInfo[] {
    if (!Array.isArray(vendureConfig.plugins)) {
        return pluginInfo;
    }
    const activePluginNames = getActivePluginNames(vendureConfig);
    return pluginInfo.filter(info => activePluginNames.has(info.name));
}

/**
 * Returns the set of class names of the plugins active in the runtime config.
 *
 * Each entry in `VendureConfig.plugins` is either:
 *   - a class decorated with `@VendurePlugin` (the most common pattern,
 *     including the return value of `SomePlugin.init(opts)` which by
 *     convention returns the class itself), or
 *   - a NestJS `DynamicModule` of the shape `{ module: SomePluginClass, ... }`,
 *     which some plugins use to return additional providers/imports.
 *
 * Matching by class name (rather than by class reference) is necessary because
 * the runtime config side and the static-discovery side load plugin modules
 * through different import paths and therefore see distinct class objects.
 * Two installed plugin packages sharing a class name would be indistinguishable
 * here, but the same limitation already exists in the discovery step (which
 * also keys on `name`), so this filter does not regress anything. If a future
 * change tracks `(pluginPath, name)` tuples through discovery, this filter
 * should be updated to match on the same key.
 */
function getActivePluginNames(vendureConfig: Pick<VendureConfig, 'plugins'>): Set<string> {
    const names = new Set<string>();
    for (const entry of vendureConfig.plugins ?? []) {
        const pluginClass =
            typeof entry === 'function'
                ? (entry as { name?: string })
                : ((entry as { module?: { name?: string } } | null)?.module ?? undefined);
        const name = pluginClass?.name;
        if (name) {
            names.add(name);
        }
    }
    return names;
}
