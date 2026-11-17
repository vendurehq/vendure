import path from 'node:path';
import { Logger, Plugin } from 'vite';

import { getBundleLibEntry } from './vite-plugin-config.js';

const DEPRECATED_ALIAS = /^@\/(vdb|graphql)(\/|$)/;

/**
 * @description
 * Redirects imports of the `@/vdb/*` and `@/graphql/*` aliases to the dashboard bundle's
 * library entry, which is also what `@vendure/dashboard` resolves to, and logs a
 * deprecation warning once for each importing file.
 *
 * Before v4, the dashboard was served from its TypeScript source, and these aliases pointed at
 * that source. With the bundle, pointing them at the source would load a second copy of the
 * dashboard's modules, with their own React contexts, so an extension's hooks would not see the
 * dashboard's providers (#4919). Redirecting to the bundle keeps imports of public exports
 * working. An import of something that `@vendure/dashboard` does not export fails with a
 * "missing export" error.
 *
 * Only used in `bundle` mode. In `source` mode the aliases point at the source, which is
 * what the dashboard's own source imports through.
 *
 * @deprecated Will be removed in v5. Import from `@vendure/dashboard` instead.
 */
export function deprecatedAliasPlugin({ packageRoot }: { packageRoot: string }): Plugin {
    const warnedImporters = new Set<string>();
    let logger: Logger | undefined;
    let libEntry: string | undefined;
    return {
        name: 'vendure:deprecated-alias',
        enforce: 'pre',
        configResolved(config) {
            logger = config.logger;
        },
        // `config.root` is the dashboard package, so file paths in the warning are relative to the cwd.
        resolveId(source, importer) {
            const match = DEPRECATED_ALIAS.exec(source);
            if (!match) {
                return;
            }
            const importerKey = importer ?? '<unknown>';
            if (!warnedImporters.has(importerKey)) {
                warnedImporters.add(importerKey);
                const where = importer ? ` in ${path.relative(process.cwd(), importer.split('?')[0])}` : '';
                logger?.warn(
                    `[@vendure/dashboard] The import "${source}"${where} uses the deprecated "@/${match[1]}" ` +
                        `alias, which will be removed in v5. Import from "@vendure/dashboard" instead.`,
                );
            }
            // Computed once, like the `@vendure/dashboard` alias, so that both resolve to the same URL.
            libEntry ??= getBundleLibEntry(packageRoot);
            return libEntry;
        },
    };
}
