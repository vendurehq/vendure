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

export interface CliPluginLoadFailure {
    packageName: string;
    reason: string;
}

/**
 * Result of loading enabled plugins. Failures are reported, not thrown, so a
 * broken plugin cannot take down the whole CLI (including the `plugins`
 * command needed to disable it).
 */
export interface CliPluginLoadResult {
    loaded: ResolvedCliPlugin[];
    failures: CliPluginLoadFailure[];
}

export type CliPluginDiscoveryStatus = 'enabled' | 'not-enabled' | 'failed';

export interface DiscoveredCliPlugin {
    packageName: string;
    status: CliPluginDiscoveryStatus;
    /**
     * Why the package was skipped or failed. Present for `failed`.
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

export interface DiscoverCliPluginsOptions extends ResolveCliPluginsOptions {
    /**
     * When true, enabled plugins are actually loaded so that a module which
     * fails `require()` or plugin validation is reported as `failed` instead
     * of `enabled`. Loading executes plugin code, so this is only done for
     * the `plugins` command (the same code runs at every normal startup).
     */
    validate?: boolean;
}

/**
 * Context exposed to the `plugins` command so its validation matches the
 * discovery/loading behaviour exactly.
 */
export interface CliPluginProjectContext {
    projectRoot: string;
    directDependencyNames: Set<string>;
    resolvePackage: (packageName: string) => { dir: string; packageJson: PackageJsonLike } | null;
}

/**
 * Finds the project root used for CLI plugin configuration by walking up from
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
 * Discovers direct dependencies that declare a CLI plugin, without loading
 * them (unless `validate` is set). Loading is opt-in via `vendure.cli.plugins`
 * — see {@link resolveCliPlugins}.
 */
export function discoverCliPlugins(options: DiscoverCliPluginsOptions = {}): DiscoveredCliPlugin[] {
    const context = getProjectPluginContext(options);
    if (!context) {
        return [];
    }

    const { projectRoot, directDependencyOrigins, allowlist, resolvePackage } = context;
    const enabledSet = new Set(allowlist ?? []);
    const discovered = new Map<string, DiscoveredCliPlugin>();

    // Scan all direct deps for packages that declare a plugin entry.
    for (const packageName of [...directDependencyOrigins.keys()].sort((a, b) => a.localeCompare(b))) {
        const resolved = resolvePackage(packageName);
        if (!resolved) {
            continue;
        }
        const entryRel = resolved.packageJson.vendure?.cliPlugin;
        if (!entryRel || typeof entryRel !== 'string') {
            continue;
        }
        discovered.set(packageName, {
            packageName,
            status: enabledSet.has(packageName) ? 'enabled' : 'not-enabled',
            reason: enabledSet.has(packageName) ? undefined : 'Not listed in vendure.cli.plugins',
            entryRel,
            entryPath: path.resolve(resolved.dir, entryRel),
            declaredCommands: normalizeDeclaredCommands(resolved.packageJson.vendure?.cliCommands),
        });
    }

    // Allowlisted packages that are missing or invalid surface as failed.
    for (const packageName of allowlist ?? []) {
        const failure = checkEnabledPluginStatically(packageName, context);
        if (failure) {
            const existing = discovered.get(packageName);
            discovered.set(packageName, {
                ...existing,
                packageName,
                status: 'failed',
                reason: failure,
            });
            continue;
        }
        if (options.validate) {
            const entry = discovered.get(packageName);
            if (entry?.entryPath) {
                try {
                    loadCliPluginModule(entry.entryPath, packageName);
                } catch (e: any) {
                    discovered.set(packageName, {
                        ...entry,
                        status: 'failed',
                        reason: e?.message ?? String(e),
                    });
                }
            }
        }
    }

    return Array.from(discovered.values());
}

/**
 * Loads CLI plugins that have been explicitly enabled in `vendure.cli.plugins`.
 *
 * Packages that declare `vendure.cliPlugin` but are not listed are discovered
 * (see {@link discoverCliPlugins}) but not executed. Per-package failures are
 * returned instead of thrown so the CLI stays usable.
 */
export function resolveCliPlugins(options: ResolveCliPluginsOptions = {}): CliPluginLoadResult {
    const context = getProjectPluginContext(options);
    if (!context || !context.allowlist || context.allowlist.length === 0) {
        return { loaded: [], failures: [] };
    }

    const loaded: ResolvedCliPlugin[] = [];
    const failures: CliPluginLoadFailure[] = [];

    for (const packageName of context.allowlist) {
        const staticFailure = checkEnabledPluginStatically(packageName, context);
        if (staticFailure) {
            failures.push({ packageName, reason: staticFailure });
            continue;
        }
        const resolved = context.resolvePackage(packageName);
        // checkEnabledPluginStatically guarantees these are present.
        const entryRel = resolved!.packageJson.vendure!.cliPlugin!;
        const entryPath = path.resolve(resolved!.dir, entryRel);
        try {
            loaded.push({ packageName, plugin: loadCliPluginModule(entryPath, packageName), entryPath });
        } catch (e: any) {
            failures.push({ packageName, reason: e?.message ?? String(e) });
        }
    }

    return { loaded, failures };
}

/**
 * Packages that declare a CLI plugin but are not currently enabled. Used for
 * the one-line startup hint.
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
        plugin => plugin.status === 'not-enabled' && plugin.declaredCommands?.includes(commandName),
    );
}

/**
 * Exposes project root, direct dependencies and package resolution to the
 * `plugins` command so its error messages match discovery behaviour.
 */
export function getCliPluginProjectContext(
    options: ResolveCliPluginsOptions = {},
): CliPluginProjectContext | null {
    const context = getProjectPluginContext(options);
    if (!context) {
        return null;
    }
    return {
        projectRoot: context.projectRoot,
        directDependencyNames: new Set(context.directDependencyOrigins.keys()),
        resolvePackage: context.resolvePackage,
    };
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

interface ProjectPluginContext {
    projectRoot: string;
    projectPackageJson: PackageJsonLike;
    /**
     * Direct dependency name → directory of the package.json that declares it.
     * In a monorepo this includes every package.json from cwd up to the
     * project root, so plugins installed in a workspace package are found
     * even when `@vendure/cli` is hoisted to the workspace root.
     */
    directDependencyOrigins: Map<string, string>;
    allowlist: string[] | undefined;
    resolvePackage: (packageName: string) => { dir: string; packageJson: PackageJsonLike } | null;
}

function getProjectPluginContext(options: ResolveCliPluginsOptions): ProjectPluginContext | null {
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = options.projectPackageJson ? path.resolve(cwd) : resolveCliProjectRoot(cwd);
    const projectPackageJson =
        options.projectPackageJson ?? readPackageJson(path.join(projectRoot, 'package.json'));

    if (!projectPackageJson) {
        return null;
    }

    const directDependencyOrigins = options.projectPackageJson
        ? new Map(listDirectDependencyNames(projectPackageJson).map(name => [name, projectRoot]))
        : collectDirectDependencyOrigins(cwd, projectRoot);

    // Explicit activation: only packages listed in plugins are loaded.
    // An empty or missing list means load nothing.
    const allowlist = projectPackageJson.vendure?.cli?.plugins
        ? [...projectPackageJson.vendure.cli.plugins]
        : undefined;

    const resolvePackage =
        options.resolvePackage ??
        ((packageName: string) =>
            defaultResolvePackage(directDependencyOrigins.get(packageName) ?? projectRoot, packageName));

    return { projectRoot, projectPackageJson, directDependencyOrigins, allowlist, resolvePackage };
}

/**
 * Runs the non-loading checks for an enabled plugin. Returns a failure reason
 * or undefined when the plugin looks loadable.
 */
function checkEnabledPluginStatically(
    packageName: string,
    context: ProjectPluginContext,
): string | undefined {
    if (!context.directDependencyOrigins.has(packageName)) {
        return `Listed in vendure.cli.plugins but is not a direct dependency of ${context.projectRoot}`;
    }
    const resolved = context.resolvePackage(packageName);
    if (!resolved) {
        return `Listed in vendure.cli.plugins but could not be resolved from ${context.projectRoot}. Check that it is installed.`;
    }
    const entryRel = resolved.packageJson.vendure?.cliPlugin;
    if (!entryRel || typeof entryRel !== 'string') {
        return 'Does not declare vendure.cliPlugin in its package.json';
    }
    const entryPath = path.resolve(resolved.dir, entryRel);
    if (!fs.existsSync(entryPath)) {
        return `Entry "${entryRel}" not found at ${entryPath}. If this is a workspace package, it may need to be built.`;
    }
    return undefined;
}

/**
 * Collects direct dependencies from every package.json between `cwd` and the
 * project root (inclusive). The nearest declaration wins, so a workspace
 * package's own dependencies take precedence over hoisted root entries.
 */
function collectDirectDependencyOrigins(cwd: string, projectRoot: string): Map<string, string> {
    const origins = new Map<string, string>();
    const resolvedRoot = path.resolve(projectRoot);
    let current = path.resolve(cwd);

    while (true) {
        const pkg = readPackageJson(path.join(current, 'package.json'));
        if (pkg) {
            for (const name of listDirectDependencyNames(pkg)) {
                if (!origins.has(name)) {
                    origins.set(name, current);
                }
            }
        }
        if (current === resolvedRoot) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return origins;
}

function normalizeDeclaredCommands(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const commands = value.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
    );
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
    baseDir: string,
    packageName: string,
): { dir: string; packageJson: PackageJsonLike } | null {
    const requireFromBase = createRequire(path.join(baseDir, 'package.json'));

    // Tier 1: package.json is exported (or no exports map).
    try {
        const packageJsonPath = requireFromBase.resolve(`${packageName}/package.json`);
        const packageJson = readPackageJson(packageJsonPath);
        if (packageJson) {
            return { dir: path.dirname(packageJsonPath), packageJson };
        }
    } catch {
        // fall through to tier 2
    }

    // Tier 2: a restrictive `exports` map hides package.json. Resolve the
    // public entry instead, then walk up to the owning package.
    try {
        let current = path.dirname(requireFromBase.resolve(packageName));
        while (true) {
            const packageJson = readPackageJson(path.join(current, 'package.json'));
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
        // fall through to tier 3
    }

    // Tier 3: path-based node_modules walk from the declaring package upward.
    // Covers packages with no resolvable JS entry and npm aliases, where the
    // installed package.json `name` differs from the dependency key so the
    // tier 2 name check can never match.
    let current = path.resolve(baseDir);
    while (true) {
        const packageJsonPath = path.join(
            current,
            'node_modules',
            ...packageName.split('/'),
            'package.json',
        );
        const packageJson = readPackageJson(packageJsonPath);
        if (packageJson) {
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
