import fs from 'fs-extra';
import { createRequire } from 'node:module';
import path from 'node:path';

import { ProjectCliPluginConfig } from './cli-command-definition';
import { assertCliPlugin, CliPlugin } from './cli-plugin';

export interface PackageJsonLike {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    vendure?: {
        cliPlugin?: string;
        /**
         * Optional declarative list of command names contributed by the plugin.
         * Used for actionable unknown-command hints without loading plugin code.
         */
        cliCommands?: string[];
        cli?: ProjectCliPluginConfig;
    };
}

export interface ResolvedCliPlugin {
    packageName: string;
    plugin: CliPlugin;
    entryPath: string;
}

export type CliPluginDiscoveryStatus = 'enabled' | 'not-enabled' | 'excluded' | 'failed';

export interface DiscoveredCliPlugin {
    packageName: string;
    status: CliPluginDiscoveryStatus;
    /**
     * Why the package was skipped or failed. Present for `excluded` and `failed`.
     */
    reason?: string;
    entryRel?: string;
    entryPath?: string;
    /**
     * Command names from package.json `vendure.cliCommands` when declared.
     */
    declaredCommands?: string[];
}

export interface ResolveCliPluginsOptions {
    /**
     * Directory to start searching for the project package.json (default: cwd).
     */
    cwd?: string;
    /**
     * Optional override for tests — skip filesystem discovery.
     */
    projectPackageJson?: PackageJsonLike;
    /**
     * Optional override for tests — map package name → package.json + dir.
     */
    resolvePackage?: (packageName: string) => { dir: string; packageJson: PackageJsonLike } | null;
}

/**
 * Finds the project root used for CLI plugin discovery by walking up from
 * `cwd` and preferring a package.json that configures `vendure.cli` or
 * depends on `@vendure/cli`.
 */
export function resolveCliProjectRoot(cwd: string = process.cwd()): string {
    let current = path.resolve(cwd);
    const roots: string[] = [];

    while (true) {
        const packageJsonPath = path.join(current, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            roots.push(current);
            try {
                const pkg = fs.readJsonSync(packageJsonPath) as PackageJsonLike;
                if (pkg.vendure?.cli || hasDirectDependency(pkg, '@vendure/cli')) {
                    return current;
                }
            } catch {
                // ignore invalid package.json and keep walking
            }
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return roots[0] ?? path.resolve(cwd);
}

/**
 * Discovers direct dependencies that declare a CLI plugin, without loading them.
 *
 * Loading is opt-in via `vendure.cli.plugins` — see {@link resolveCliPlugins}.
 */
export function discoverCliPlugins(options: ResolveCliPluginsOptions = {}): DiscoveredCliPlugin[] {
    const context = getProjectPluginContext(options);
    if (!context) {
        return [];
    }

    const { projectRoot, projectPackageJson, resolvePackage, allowlist, exclude } = context;
    const directDependencyNames = new Set(listDirectDependencyNames(projectPackageJson));
    const discovered = new Map<string, DiscoveredCliPlugin>();

    // Scan all direct deps for packages that declare a plugin entry.
    for (const packageName of [...directDependencyNames].sort((a, b) => a.localeCompare(b))) {
        const resolved = resolvePackage(packageName);
        if (!resolved) {
            continue;
        }
        const entryRel = resolved.packageJson.vendure?.cliPlugin;
        if (!entryRel || typeof entryRel !== 'string') {
            continue;
        }
        const declaredCommands = normalizeDeclaredCommands(resolved.packageJson.vendure?.cliCommands);
        const entryPath = path.resolve(resolved.dir, entryRel);

        if (exclude.has(packageName)) {
            discovered.set(packageName, {
                packageName,
                status: 'excluded',
                reason: 'Listed in vendure.cli.exclude',
                entryRel,
                entryPath,
                declaredCommands,
            });
            continue;
        }

        if (allowlist?.includes(packageName)) {
            discovered.set(packageName, {
                packageName,
                status: 'enabled',
                entryRel,
                entryPath,
                declaredCommands,
            });
            continue;
        }

        discovered.set(packageName, {
            packageName,
            status: 'not-enabled',
            reason: 'Not listed in vendure.cli.plugins',
            entryRel,
            entryPath,
            declaredCommands,
        });
    }

    // Allowlisted packages that are missing or invalid surface as failed.
    if (allowlist) {
        for (const packageName of allowlist) {
            if (exclude.has(packageName)) {
                discovered.set(packageName, {
                    packageName,
                    status: 'excluded',
                    reason: 'Listed in vendure.cli.exclude',
                });
                continue;
            }
            if (!directDependencyNames.has(packageName)) {
                discovered.set(packageName, {
                    packageName,
                    status: 'failed',
                    reason: `Listed in vendure.cli.plugins but is not a direct dependency of ${projectRoot}`,
                });
                continue;
            }
            const resolved = resolvePackage(packageName);
            if (!resolved) {
                discovered.set(packageName, {
                    packageName,
                    status: 'failed',
                    reason: `Listed in vendure.cli.plugins but was not found from ${projectRoot}`,
                });
                continue;
            }
            const entryRel = resolved.packageJson.vendure?.cliPlugin;
            if (!entryRel || typeof entryRel !== 'string') {
                discovered.set(packageName, {
                    packageName,
                    status: 'failed',
                    reason: 'Does not declare vendure.cliPlugin in its package.json',
                });
                continue;
            }
            const entryPath = path.resolve(resolved.dir, entryRel);
            if (!fs.existsSync(entryPath)) {
                discovered.set(packageName, {
                    packageName,
                    status: 'failed',
                    reason: `Entry "${entryRel}" not found at ${entryPath}`,
                    entryRel,
                    entryPath,
                });
                continue;
            }
            if (!discovered.has(packageName)) {
                discovered.set(packageName, {
                    packageName,
                    status: 'enabled',
                    entryRel,
                    entryPath,
                    declaredCommands: normalizeDeclaredCommands(resolved.packageJson.vendure?.cliCommands),
                });
            }
        }
    }

    return Array.from(discovered.values());
}

/**
 * Loads CLI plugins that have been explicitly enabled in `vendure.cli.plugins`.
 *
 * Packages that declare `vendure.cliPlugin` but are not listed are discovered
 * (see {@link discoverCliPlugins}) but not executed.
 */
export function resolveCliPlugins(options: ResolveCliPluginsOptions = {}): ResolvedCliPlugin[] {
    const context = getProjectPluginContext(options);
    if (!context) {
        return [];
    }

    const { projectRoot, resolvePackage, allowlist, exclude } = context;
    if (!allowlist || allowlist.length === 0) {
        return [];
    }

    const loaded: ResolvedCliPlugin[] = [];

    for (const packageName of allowlist) {
        if (exclude.has(packageName)) {
            continue;
        }

        const directDependencyNames = new Set(listDirectDependencyNames(context.projectPackageJson));
        if (!directDependencyNames.has(packageName)) {
            throw new Error(
                `CLI plugin package "${packageName}" is listed in vendure.cli.plugins but is not a direct dependency of ${projectRoot}`,
            );
        }

        const resolved = resolvePackage(packageName);
        if (!resolved) {
            throw new Error(
                `CLI plugin package "${packageName}" listed in vendure.cli.plugins was not found from ${projectRoot}`,
            );
        }

        const entryRel = resolved.packageJson.vendure?.cliPlugin;
        if (!entryRel || typeof entryRel !== 'string') {
            throw new Error(
                `CLI plugin package "${packageName}" does not declare vendure.cliPlugin in its package.json`,
            );
        }

        const entryPath = path.resolve(resolved.dir, entryRel);
        if (!fs.existsSync(entryPath)) {
            throw new Error(`CLI plugin "${packageName}" entry "${entryRel}" not found at ${entryPath}`);
        }

        const plugin = loadCliPluginModule(entryPath, packageName);
        loaded.push({ packageName, plugin, entryPath });
    }

    return loaded;
}

/**
 * Packages that declare a CLI plugin but are not currently loaded (not enabled
 * or excluded). Used for the one-line startup hint.
 */
export function listInactiveCliPluginPackages(options: ResolveCliPluginsOptions = {}): string[] {
    return discoverCliPlugins(options)
        .filter(plugin => plugin.status === 'not-enabled')
        .map(plugin => plugin.packageName);
}

/**
 * Finds an inactive plugin package that declares it provides `commandName`
 * via `vendure.cliCommands`. Does not load plugin code.
 */
export function findInactivePluginProvidingCommand(
    commandName: string,
    options: ResolveCliPluginsOptions = {},
): DiscoveredCliPlugin | undefined {
    return discoverCliPlugins(options).find(
        plugin =>
            plugin.status === 'not-enabled' &&
            plugin.declaredCommands?.includes(commandName),
    );
}

export function listDirectDependencyNames(pkg: PackageJsonLike): string[] {
    const names = new Set<string>();
    for (const section of [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies]) {
        if (section) {
            for (const name of Object.keys(section)) {
                names.add(name);
            }
        }
    }
    return Array.from(names);
}

function getProjectPluginContext(options: ResolveCliPluginsOptions) {
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = options.projectPackageJson ? path.resolve(cwd) : resolveCliProjectRoot(cwd);
    const projectPackageJson =
        options.projectPackageJson ?? readPackageJson(path.join(projectRoot, 'package.json'));

    if (!projectPackageJson) {
        return null;
    }

    const cliConfig = projectPackageJson.vendure?.cli;
    const exclude = new Set(cliConfig?.exclude ?? []);
    // Explicit activation: only packages listed in plugins are loaded.
    // An empty or missing list means load nothing.
    const allowlist = cliConfig?.plugins ? [...cliConfig.plugins] : undefined;
    const resolvePackage =
        options.resolvePackage ?? ((packageName: string) => defaultResolvePackage(projectRoot, packageName));

    return {
        projectRoot,
        projectPackageJson,
        resolvePackage,
        allowlist,
        exclude,
    };
}

function normalizeDeclaredCommands(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const commands = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return commands.length > 0 ? commands : undefined;
}

function hasDirectDependency(pkg: PackageJsonLike, name: string): boolean {
    return Boolean(
        pkg.dependencies?.[name] || pkg.devDependencies?.[name] || pkg.optionalDependencies?.[name],
    );
}

function readPackageJson(packageJsonPath: string): PackageJsonLike | null {
    if (!fs.existsSync(packageJsonPath)) {
        return null;
    }
    try {
        return fs.readJsonSync(packageJsonPath) as PackageJsonLike;
    } catch {
        return null;
    }
}

function defaultResolvePackage(
    projectRoot: string,
    packageName: string,
): { dir: string; packageJson: PackageJsonLike } | null {
    const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
    try {
        const packageJsonPath = requireFromProject.resolve(`${packageName}/package.json`);
        const packageJson = readPackageJson(packageJsonPath);
        if (!packageJson) {
            return null;
        }
        return { dir: path.dirname(packageJsonPath), packageJson };
    } catch {
        // Packages with a restrictive `exports` map commonly hide package.json.
        // Resolve their public entry instead, then walk up to the owning package.
        try {
            let current = path.dirname(requireFromProject.resolve(packageName));
            while (true) {
                const packageJsonPath = path.join(current, 'package.json');
                const packageJson = readPackageJson(packageJsonPath);
                if (packageJson?.name === packageName) {
                    return { dir: current, packageJson };
                }
                const parent = path.dirname(current);
                if (parent === current) {
                    break;
                }
                current = parent;
            }
        } catch {
            // A package may expose neither its root nor package.json. Classic
            // node_modules layouts can still be resolved by walking ancestors,
            // which also covers npm/pnpm workspace hoisting.
            let current = projectRoot;
            while (true) {
                const packageJsonPath = path.join(
                    current,
                    'node_modules',
                    ...packageName.split('/'),
                    'package.json',
                );
                const packageJson = readPackageJson(packageJsonPath);
                if (packageJson?.name === packageName) {
                    return { dir: path.dirname(packageJsonPath), packageJson };
                }
                const parent = path.dirname(current);
                if (parent === current) {
                    break;
                }
                current = parent;
            }
            return null;
        }
        return null;
    }
}

function loadCliPluginModule(entryPath: string, packageName: string): CliPlugin {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(entryPath) as { default?: unknown } | CliPlugin;
        const exported = (mod as { default?: unknown }).default ?? mod;
        assertCliPlugin(exported);
        return exported;
    } catch (e: any) {
        throw new Error(
            `Failed to load CLI plugin "${packageName}" from ${entryPath}: ${e?.message ?? String(e)}`,
        );
    }
}
