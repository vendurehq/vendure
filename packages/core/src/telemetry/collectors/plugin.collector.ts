import { DynamicModule, Injectable, Type } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';

import { ConfigService } from '../../config/config.service';
import { isDynamicModule } from '../../plugin/plugin-metadata';
import { TelemetryPluginInfo } from '../telemetry.types';

/**
 * Known Vendure plugins mapped to their npm package names.
 * This is more reliable than require.cache inspection which fails with ESM/TypeScript.
 */
const KNOWN_VENDURE_PLUGINS: Record<string, string> = {
    // @vendure/core
    DefaultSearchPlugin: '@vendure/core',
    DefaultJobQueuePlugin: '@vendure/core',
    DefaultSchedulerPlugin: '@vendure/core',
    // @vendure/asset-server-plugin
    AssetServerPlugin: '@vendure/asset-server-plugin',
    // @vendure/email-plugin
    EmailPlugin: '@vendure/email-plugin',
    // @vendure/admin-ui-plugin
    AdminUiPlugin: '@vendure/admin-ui-plugin',
    // @vendure/dashboard
    DashboardPlugin: '@vendure/dashboard',
    // @vendure/job-queue-plugin
    BullMQJobQueuePlugin: '@vendure/job-queue-plugin',
    // @vendure/graphiql-plugin
    GraphiqlPlugin: '@vendure/graphiql-plugin',
    // @vendure/harden-plugin
    HardenPlugin: '@vendure/harden-plugin',
    // Community plugins (moved to @vendure-community/*)
    ElasticsearchPlugin: '@vendure-community/elasticsearch-plugin',
    SentryPlugin: '@vendure-community/sentry-plugin',
    StripePlugin: '@vendure-community/stripe-plugin',
    MolliePlugin: '@vendure-community/mollie-plugin',
    BraintreePlugin: '@vendure-community/braintree-plugin',
};

/**
 * npm package names that identify official Vendure plugins, derived from the
 * known-plugin map above so there is a single source of truth.
 */
const KNOWN_VENDURE_PACKAGES = new Set(Object.values(KNOWN_VENDURE_PLUGINS));

/**
 * Determines whether an npm package name belongs to the Vendure plugin
 * ecosystem. Deliberately restricted to packages published on the public npm
 * registry under the official (`@vendure/*-plugin`, plus `@vendure/core`) and
 * community (`@vendure-community/*`) scopes.
 *
 * Arbitrary third-party or privately-named packages are intentionally NOT
 * matched here, so that scanning the host `package.json` can never transmit a
 * private or internal package name — preserving the guarantee that custom
 * plugin names are not collected. Such third-party plugins are still detected
 * by package name via require.cache when they are actually loaded under
 * CommonJS.
 */
export function isVendurePluginPackage(name: string): boolean {
    return (
        KNOWN_VENDURE_PACKAGES.has(name) ||
        name.startsWith('@vendure-community/') ||
        (name.startsWith('@vendure/') && name.endsWith('-plugin'))
    );
}

/**
 * Collects information about plugins used in the Vendure installation.
 * Detects npm packages by checking if the plugin originates from node_modules.
 * Custom plugin names are NOT collected for privacy.
 */
@Injectable()
export class PluginCollector {
    constructor(private readonly configService: ConfigService) {}

    collect(): TelemetryPluginInfo {
        try {
            const plugins = this.configService.plugins;
            const npmPlugins = new Set<string>();
            let customCount = 0;

            for (const plugin of plugins) {
                try {
                    const npmPackage = this.findNpmPackage(plugin);

                    if (npmPackage) {
                        npmPlugins.add(npmPackage);
                    } else {
                        customCount++;
                    }
                } catch {
                    customCount++;
                }
            }

            // Also record Vendure ecosystem packages declared in the host
            // package.json. This filesystem-based detection is ESM-safe and
            // catches official/community plugin packages (and @vendure/core)
            // that require.cache inspection misses when modules are loaded as
            // native ESM. Only public ecosystem packages are matched (see
            // isVendurePluginPackage), so no private package name is ever sent.
            for (const pkg of this.getDeclaredVendurePackages()) {
                npmPlugins.add(pkg);
            }

            return {
                npm: Array.from(npmPlugins).sort((a, b) => a.localeCompare(b)),
                customCount,
            };
        } catch {
            return { npm: [], customCount: 0 };
        }
    }

    /**
     * Reads every `package.json` found by walking up from each search directory
     * and returns the names of declared Vendure plugin packages. Relies only on
     * the filesystem, so it works regardless of whether plugins were loaded via
     * CommonJS or native ESM.
     *
     * Monorepo-aware: it merges manifests up the tree (stopping at a project
     * boundary) and searches from both the current working directory and the
     * application entry point. This covers workspace layouts where plugin
     * dependencies live in a sub-package and/or the repository root, and where
     * the process is started from a different directory than the app package.
     *
     * Only runtime dependency sections are scanned (`dependencies` and
     * `optionalDependencies`); `devDependencies` are excluded since they are
     * not runtime plugins. Returns an empty array on any failure.
     */
    getDeclaredVendurePackages(searchDirs: string[] = this.getManifestSearchDirs()): string[] {
        const found = new Set<string>();
        const visited = new Set<string>();

        for (const startDir of searchDirs) {
            for (const pkgPath of this.findPackageJsonPaths(startDir)) {
                if (visited.has(pkgPath)) {
                    continue;
                }
                visited.add(pkgPath);
                for (const name of this.readVendurePackagesFromManifest(pkgPath)) {
                    found.add(name);
                }
            }
        }

        return Array.from(found);
    }

    /**
     * Parses a single `package.json` and returns the Vendure ecosystem package
     * names declared in its runtime dependency sections. Returns an empty array
     * if the manifest cannot be read or parsed.
     */
    private readVendurePackagesFromManifest(pkgPath: string): string[] {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const depNames = [
                ...Object.keys(pkg.dependencies ?? {}),
                ...Object.keys(pkg.optionalDependencies ?? {}),
            ];
            return depNames.filter(isVendurePluginPackage);
        } catch {
            return [];
        }
    }

    /**
     * The directories from which to search for package.json manifests: the
     * current working directory (the primary signal) and, when resolvable, the
     * directory of the application entry point — which in a monorepo may sit in
     * a different workspace package than the cwd. Deduplicated.
     */
    private getManifestSearchDirs(): string[] {
        const dirs = new Set<string>([process.cwd()]);
        const mainFile = typeof require === 'undefined' ? undefined : require.main?.filename;
        const entryFile = mainFile ?? process.argv[1];
        if (entryFile) {
            dirs.add(path.dirname(entryFile));
        }
        return Array.from(dirs);
    }

    /**
     * Returns the paths of all `package.json` files found by walking up from
     * `startDir`, stopping at a project boundary — a directory containing a
     * `.git` entry (repo root) or a `node_modules` directory (install /
     * workspace root). Both markers exist in real deployments, so the walk
     * stays inside the project rather than reading unrelated ancestor
     * manifests. Bounded to a fixed depth as a final safety net.
     */
    private findPackageJsonPaths(startDir: string): string[] {
        const paths: string[] = [];
        let dir = startDir;
        for (let i = 0; i < 15; i++) {
            const candidate = path.join(dir, 'package.json');
            if (fs.existsSync(candidate)) {
                paths.push(candidate);
            }
            if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'node_modules'))) {
                break;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
        return paths;
    }

    /**
     * Finds the npm package name for a plugin.
     * First checks against known Vendure plugins, then falls back to require.cache inspection.
     */
    private findNpmPackage(plugin: Type<any> | DynamicModule): string | undefined {
        const pluginClass = isDynamicModule(plugin) ? plugin.module : plugin;
        if (!pluginClass) {
            return undefined;
        }
        const pluginName = pluginClass.name ?? 'unknown';

        // First, check against known Vendure plugins (most reliable)
        const knownPackage = KNOWN_VENDURE_PLUGINS[pluginName];
        if (knownPackage) {
            return knownPackage;
        }

        // Fall back to require.cache inspection for third-party npm plugins
        return this.findInRequireCache(pluginClass);
    }

    /**
     * Searches the require cache for a plugin class.
     * This is a fallback for third-party npm plugins not in our known list.
     */
    private findInRequireCache(pluginClass: Type<any>): string | undefined {
        // Check if require.cache is available (may not be in ESM-only environments)
        if (typeof require === 'undefined' || !require.cache) {
            return undefined;
        }

        try {
            for (const [modulePath, moduleObj] of Object.entries(require.cache)) {
                if (!moduleObj?.exports || !modulePath.includes('node_modules')) {
                    continue;
                }

                try {
                    const exports = moduleObj.exports;

                    // Direct match or default export match
                    if (exports === pluginClass || exports?.default === pluginClass) {
                        return this.extractPackageName(modulePath);
                    }

                    // Check named exports
                    if (typeof exports === 'object' && exports !== null) {
                        const exportValues = Object.values(exports);
                        if (exportValues.includes(pluginClass)) {
                            return this.extractPackageName(modulePath);
                        }
                    }
                } catch {
                    // Skip modules with problematic exports
                    continue;
                }
            }
        } catch {
            // Ignore errors accessing require.cache
        }

        return undefined;
    }

    /**
     * Extracts the npm package name from a node_modules path.
     * Handles both scoped (@scope/package) and unscoped packages.
     */
    private extractPackageName(modulePath: string): string | undefined {
        const nodeModulesIndex = modulePath.lastIndexOf('node_modules');
        if (nodeModulesIndex === -1) {
            return undefined;
        }

        const pathAfterNodeModules = modulePath.slice(nodeModulesIndex + 'node_modules/'.length);
        const parts = pathAfterNodeModules.split(/[/\\]/);

        if (parts[0].startsWith('@')) {
            // Scoped package: @scope/package
            return `${parts[0]}/${parts[1]}`;
        }
        return parts[0];
    }
}
