import fs from 'fs-extra';
import { createRequire } from 'node:module';
import path from 'node:path';

import { ProjectCliPluginConfig } from './cli-command-definition';
import { mergeEnvPluginNames, readGlobalCliConfig } from './cli-global-plugin-config';
import { assertCliPlugin, CliPlugin } from './cli-plugin';
import { walkUp } from './project-validation';

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
    /** Which allowlist enabled it. */
    scope: CliPluginScopeKind;
}

export interface CliPluginLoadFailure {
    packageName: string;
    reason: string;
    /** Which allowlist listed it. */
    scope: CliPluginScopeKind;
}

/**
 * A problem with a scope itself rather than with any package in it, such as a
 * config file that cannot be parsed.
 *
 * Kept apart from {@link CliPluginLoadFailure} because the two need different
 * words: a package failure names a package and can be answered by disabling it,
 * while this names a file and can only be answered by fixing or deleting it.
 */
export interface CliPluginScopeError {
    scope: CliPluginScopeKind;
    /** The file or directory the allowlist was read from. */
    origin: string;
    reason: string;
}

/**
 * Result of loading enabled plugins. Problems are reported, not thrown, so a
 * broken plugin or a broken config file cannot take down the whole CLI
 * (including the `plugins` command needed to disable a plugin).
 */
export interface CliPluginLoadResult {
    loaded: ResolvedCliPlugin[];
    failures: CliPluginLoadFailure[];
    scopeErrors: CliPluginScopeError[];
}

export type CliPluginDiscoveryStatus = 'enabled' | 'not-enabled' | 'failed';

/**
 * Where a plugin's activation is configured, and where its package is resolved
 * from.
 *
 * `project` is the project's own `package.json#vendure.cli.plugins`, resolved
 * from the project. `global` is the user-level `cli.json`, resolved from the
 * CLI's own installation directory, which is how a globally installed CLI
 * reaches a globally installed plugin: the two are siblings in the same
 * `node_modules`.
 */
export type CliPluginScopeKind = 'project' | 'global';

/** Scope registration order: global first, so a project overrides the machine. */
export const ALL_PLUGIN_SCOPES: readonly CliPluginScopeKind[] = Object.freeze(['global', 'project']);

/**
 * The `vendure plugins` command that acts on a given scope.
 *
 * One place spells the flag, so advice printed from the CLI host, from the
 * `plugins` command and from an unknown-command hint cannot disagree about it.
 */
export function pluginsCommandFor(
    action: 'add' | 'remove',
    packageName: string,
    scope: CliPluginScopeKind,
): string {
    return `vendure plugins ${action}${scope === 'global' ? ' --global' : ''} ${packageName}`;
}

export interface DiscoveredCliPlugin {
    packageName: string;
    status: CliPluginDiscoveryStatus;
    /** Which allowlist the package was found through. */
    scope: CliPluginScopeKind;
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
    /**
     * Top-level command names read from the plugin module itself. Only known
     * when the plugin was actually loaded, which `validate` does for enabled
     * plugins. Read it through {@link cliPluginCommandNames}, which falls back
     * to {@link declaredCommands} for a package that was not loaded.
     */
    loadedCommands?: string[];
}

/**
 * The commands a package contributes, as accurately as is known.
 *
 * An enabled plugin is loaded, so its real command names are used. A package
 * that is only installed is not executed, so what it declares in
 * `vendure.cliCommands` is the best available answer, and an empty list means
 * the package declared nothing rather than that it contributes nothing.
 */
export function cliPluginCommandNames(plugin: DiscoveredCliPlugin): string[] {
    return plugin.loadedCommands ?? plugin.declaredCommands ?? [];
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
    /**
     * Environment the global scope reads its allowlist and config directory
     * from. Defaults to `process.env`.
     */
    env?: NodeJS.ProcessEnv;
    /**
     * Which scopes to consider. Defaults to all of them.
     *
     * A test about project behaviour passes `['project']`, so that whatever the
     * machine running it happens to have enabled globally cannot change the
     * result.
     */
    scopes?: CliPluginScopeKind[];
    /**
     * Locates the CLI's own installation, which decides whether the global
     * scope has an installation directory to work from. Overridden by tests, so
     * that both a global and a project-local layout can be exercised without
     * installing anything.
     */
    findCliInstall?: () => CliInstallLocation | undefined;
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
    const scopes = getPluginScopes(options);
    const owner = owningScopes(scopes);
    const discovered: DiscoveredCliPlugin[] = [];
    for (const scope of scopes) {
        // Every scope is still listed, so `vendure plugins` can show that a
        // package is enabled in both. Only the scope that startup would load
        // from may import the module: validating the other would execute a copy
        // the CLI has undertaken never to run.
        const mayLoad = (packageName: string) => owner.get(packageName) === scope;
        discovered.push(...discoverInScope(scope, options.validate === true, mayLoad));
    }
    return discovered;
}

/**
 * Discovers the packages one scope can see. Kept separate from the merging
 * above so that each scope answers only for itself.
 */
function discoverInScope(
    scope: PluginScope,
    validate: boolean,
    mayLoad: (packageName: string) => boolean,
): DiscoveredCliPlugin[] {
    const enabled = new Set(scope.allowlist);
    const discovered = new Map<string, DiscoveredCliPlugin>();

    for (const packageName of [...scope.listCandidates()].sort((a, b) => a.localeCompare(b))) {
        const entry = describePackage(scope, packageName, enabled.has(packageName));
        if (entry) {
            discovered.set(packageName, entry);
        }
    }

    for (const packageName of scope.allowlist) {
        const entry = describeEnabledPackage(scope, packageName, discovered.get(packageName));
        if (!entry) {
            continue;
        }
        const load = validate && entry.status !== 'failed' && mayLoad(packageName);
        discovered.set(packageName, load ? withLoadedCommands(entry, packageName) : entry);
    }

    return Array.from(discovered.values());
}

/**
 * Describes a package the scope can resolve and which declares a plugin entry,
 * or `undefined` for one that does neither — an ordinary dependency that has
 * nothing to do with the CLI.
 */
function describePackage(
    scope: PluginScope,
    packageName: string,
    isEnabled: boolean,
): DiscoveredCliPlugin | undefined {
    const resolved = scope.resolvePackage(packageName);
    const entryRel = resolved?.packageJson.vendure?.cliPlugin;
    if (!resolved || typeof entryRel !== 'string') {
        return undefined;
    }
    return {
        packageName,
        scope: scope.kind,
        status: isEnabled ? 'enabled' : 'not-enabled',
        reason: isEnabled ? undefined : notEnabledReason(scope),
        entryRel,
        entryPath: path.resolve(resolved.dir, entryRel),
        declaredCommands: normalizeDeclaredCommands(resolved.packageJson.vendure?.cliCommands),
    };
}

/**
 * Describes a package the scope lists as enabled, given whatever scanning
 * already found for it.
 *
 * A package that fails its scope's checks is reported as `failed`, keeping
 * whatever was known about it. One that passes but scanning never turned up is
 * described from scratch, which happens whenever a scope can resolve more than
 * it can enumerate: a `pluginRoots` directory, or a CLI that is not installed
 * inside a `node_modules` it could scan. Without that it would load at startup
 * and yet be missing from `vendure plugins`.
 */
function describeEnabledPackage(
    scope: PluginScope,
    packageName: string,
    found: DiscoveredCliPlugin | undefined,
): DiscoveredCliPlugin | undefined {
    const failure = scope.check(packageName);
    if (failure) {
        return { ...found, packageName, scope: scope.kind, status: 'failed', reason: failure };
    }
    return found ?? describePackage(scope, packageName, true);
}

/**
 * Adds the command names read from the plugin module itself, which are the real
 * ones and so outrank whatever `vendure.cliCommands` declares. The module is
 * loaded to read them, so a module that cannot be loaded is reported as failed
 * here rather than at the next startup.
 */
function withLoadedCommands(entry: DiscoveredCliPlugin, packageName: string): DiscoveredCliPlugin {
    if (!entry.entryPath) {
        return entry;
    }
    try {
        const plugin = loadCliPluginModule(entry.entryPath, packageName);
        return { ...entry, loadedCommands: plugin.commands.map(command => command.name) };
    } catch (e: any) {
        return { ...entry, status: 'failed', reason: e?.message ?? String(e) };
    }
}

function notEnabledReason(scope: PluginScope): string {
    return scope.kind === 'project' ? 'Not listed in vendure.cli.plugins' : `Not listed in ${scope.origin}`;
}

/**
 * The one eligibility check both scopes share: a package can only be loaded as
 * a plugin if it says it is one.
 */
function checkDeclaresPlugin(
    packageName: string,
    resolvePackage: PluginScope['resolvePackage'],
): string | undefined {
    const resolved = resolvePackage(packageName);
    if (!resolved) {
        // The scope's own rule already reported this; nothing to add.
        return undefined;
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
 * Loads CLI plugins that have been explicitly enabled in `vendure.cli.plugins`.
 *
 * Packages that declare `vendure.cliPlugin` but are not listed are discovered
 * (see {@link discoverCliPlugins}) but not executed. Per-package failures are
 * returned instead of thrown so the CLI stays usable.
 */
export function resolveCliPlugins(options: ResolveCliPluginsOptions = {}): CliPluginLoadResult {
    const scopes = getPluginScopes(options);
    const owner = owningScopes(scopes);
    const result: CliPluginLoadResult = { loaded: [], failures: [], scopeErrors: [] };

    for (const scope of scopes) {
        if (scope.error) {
            result.scopeErrors.push({ scope: scope.kind, origin: scope.origin, reason: scope.error });
        }
        for (const packageName of scope.allowlist) {
            if (owner.get(packageName) === scope) {
                loadInto(result, scope, packageName);
            }
        }
    }

    return result;
}

/**
 * The scope each enabled package is loaded from, when more than one enables it.
 *
 * The last scope wins, which is the project, so the copy pinned alongside the
 * project's code is the one that runs. Loading both would apply the plugin
 * twice and run any `afterConsoleLink` hook twice per link.
 *
 * The project's copy is used even when it turns out to be unusable — not a
 * direct dependency, say — rather than falling back to the global one. A
 * project that names a plugin has said which copy it wants, and quietly running
 * a different version of it is worse than reporting that the named one cannot
 * be loaded. The failure names the project, so the reader can see which of the
 * two lists to change.
 */
function owningScopes(scopes: PluginScope[]): Map<string, PluginScope> {
    const owner = new Map<string, PluginScope>();
    for (const scope of scopes) {
        for (const packageName of scope.allowlist) {
            owner.set(packageName, scope);
        }
    }
    return owner;
}

/** Loads one package, recording either the plugin or the reason it could not be. */
function loadInto(result: CliPluginLoadResult, scope: PluginScope, packageName: string): void {
    const fail = (reason: string) => result.failures.push({ packageName, reason, scope: scope.kind });

    const ineligible = scope.check(packageName);
    if (ineligible) {
        fail(ineligible);
        return;
    }

    const resolved = scope.resolvePackage(packageName);
    const entryRel = resolved?.packageJson.vendure?.cliPlugin;
    if (!resolved || typeof entryRel !== 'string') {
        fail('Passed every check but no plugin entry could be resolved');
        return;
    }

    const entryPath = path.resolve(resolved.dir, entryRel);
    try {
        result.loaded.push({
            packageName,
            plugin: loadCliPluginModule(entryPath, packageName),
            entryPath,
            scope: scope.kind,
        });
    } catch (e: any) {
        fail(e?.message ?? String(e));
    }
}

/**
 * Packages that declare a CLI plugin but are not currently enabled. Used for
 * the one-line startup hint.
 */
export function listInactiveCliPluginPackages(options: ResolveCliPluginsOptions = {}): string[] {
    return listInactiveCliPlugins(options).map(plugin => plugin.packageName);
}

/**
 * As {@link listInactiveCliPluginPackages}, keeping the scope each package was
 * found in so a hint can name the command that would enable it.
 */
export function listInactiveCliPlugins(options: ResolveCliPluginsOptions = {}): DiscoveredCliPlugin[] {
    return discoverCliPlugins(options).filter(plugin => plugin.status === 'not-enabled');
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

/**
 * One place plugins can be enabled from, and everything needed to act on it.
 *
 * The project scope and the global scope differ in three ways and agree on
 * everything else, which is what this captures: where the allowlist is read
 * from, what makes a listed package eligible, and which packages the scope can
 * see at all. The loading, validating and reporting below is the same for both.
 */
export interface PluginScope {
    kind: CliPluginScopeKind;
    /**
     * Where the allowlist lives, named in failure messages so the reader knows
     * which file to edit: a project directory, or the path of `cli.json`.
     */
    origin: string;
    allowlist: string[];
    resolvePackage: (packageName: string) => { dir: string; packageJson: PackageJsonLike } | null;
    /**
     * Why a listed package cannot be loaded from this scope, or `undefined`
     * when it can.
     *
     * Composed from the scope's own rule — a project requires a direct
     * dependency, while the global scope has no manifest for anything to be a
     * dependency of and so requires only that the package resolves — and the
     * rule every scope shares, that the package declares a usable plugin entry.
     * Composed here so the three callers cannot drift apart.
     */
    check: (packageName: string) => string | undefined;
    /**
     * Packages this scope can see, whether or not they are enabled. Used to
     * report a package that is installed but not enabled.
     */
    listCandidates: () => string[];
    /** A problem with the scope itself, reported once rather than per package. */
    error?: string;
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

/**
 * Where `@vendure/cli` itself is installed, and whether that is a global
 * installation.
 */
export interface CliInstallLocation {
    /** The `@vendure/cli` package directory. */
    packageDir: string;
    /**
     * The `node_modules` the CLI sits in, and only when that is a global one.
     *
     * Undefined for a project-local install. The CLI is most often a
     * devDependency, and then the `node_modules` it sits in is the project's
     * own. Treating that as the global install root would report every
     * dependency of the project a second time as a machine-wide package, and
     * offer to enable it machine-wide, which would write a project's package
     * into the config of every other project on the machine.
     */
    globalNodeModules?: string;
}

/**
 * Locates the CLI's own installation.
 *
 * Resolved through symlinks, because the installed CLI is often reached by
 * one: npm links its `bin`, and pnpm, Volta and asdf link the package
 * directory itself into a store. Resolving from the link rather than its
 * target would look for sibling packages in a directory that has none.
 */
export function findCliInstallLocation(fromDir?: string): CliInstallLocation | undefined {
    let current: string;
    try {
        current = fs.realpathSync(fromDir ?? __dirname);
    } catch {
        return undefined;
    }
    const packageDir = findNearestPackageDir(current);
    if (!packageDir) {
        return undefined;
    }
    const nodeModules = findContainingNodeModules(packageDir);
    return {
        packageDir,
        globalNodeModules: nodeModules && isGlobalNodeModules(nodeModules) ? nodeModules : undefined,
    };
}

function findNearestPackageDir(startDir: string): string | undefined {
    return walkUp(startDir, dir => fs.existsSync(path.join(dir, 'package.json')));
}

/**
 * The `node_modules` a package directory sits in, if any. Absent when the CLI
 * is being run from a source checkout, whose packages are not inside one.
 */
function findContainingNodeModules(packageDir: string): string | undefined {
    return walkUp(path.dirname(packageDir), dir => path.basename(dir) === 'node_modules');
}

/**
 * Whether a `node_modules` is a global installation root rather than one
 * belonging to a project.
 *
 * The test is whether the directory holding it has a `package.json`. Every
 * package manager creates `node_modules` beside the manifest it installs for,
 * so a project always has one there — including a workspace root, whose
 * manifest carries `workspaces` and the shared tooling while the Vendure
 * dependency sits in a package below. A global root has no manifest above it:
 * `<prefix>/lib/node_modules` and the equivalents under nvm, Volta and asdf.
 *
 * Asking instead whether a Vendure project is above it reads a workspace root
 * as global, because the Vendure dependency is below the hoisted
 * `node_modules`, not above it. Asking whether *any* ancestor has a
 * `package.json` reads a real nvm installation as not global, because nvm ships
 * one at the root of its own directory.
 *
 * pnpm's global store does carry a manifest, so a pnpm global install is not
 * recognised here and is reached through `pluginRoots` instead.
 */
function isGlobalNodeModules(nodeModulesDir: string): boolean {
    return !fs.existsSync(path.join(path.dirname(nodeModulesDir), 'package.json'));
}

/**
 * Package names installed directly in `nodeModulesDir`, descending one level
 * into scope directories so `@vendure/cloud` is found as well as `some-cli`.
 *
 * Only the global scope needs this. A project lists its dependencies in a
 * manifest, so there is nothing to scan; a `node_modules` has no manifest of
 * its own, so the directory itself is the only record of what is there.
 */
function listInstalledPackageNames(nodeModulesDir: string): string[] {
    return readDirectory(nodeModulesDir)
        .filter(entry => !entry.startsWith('.'))
        .flatMap(entry => (entry.startsWith('@') ? listScopedPackageNames(nodeModulesDir, entry) : [entry]));
}

/** The packages inside one `@scope` directory, named `@scope/package`. */
function listScopedPackageNames(nodeModulesDir: string, scopeDir: string): string[] {
    return readDirectory(path.join(nodeModulesDir, scopeDir))
        .filter(entry => !entry.startsWith('.'))
        .map(entry => `${scopeDir}/${entry}`);
}

/** Directory entries, or none at all when the directory cannot be read. */
function readDirectory(dir: string): string[] {
    try {
        return fs.readdirSync(dir);
    } catch {
        return [];
    }
}

/**
 * The global scope.
 *
 * Always built, even with nothing enabled: an empty allowlist loads nothing,
 * but the scope still knows which packages are installed beside the CLI, which
 * is what lets an unknown command say that the package providing it is
 * installed and how to enable it.
 *
 * Built even when the CLI cannot find its own installation directory, so long
 * as `pluginRoots` gives somewhere to resolve from: that option exists for
 * exactly the install layouts this would otherwise fail on.
 */
function getGlobalPluginScope(
    env: NodeJS.ProcessEnv,
    findInstall: () => CliInstallLocation | undefined,
): PluginScope {
    const { config, path: configPath, error } = readGlobalCliConfig(env);
    const allowlist = mergeEnvPluginNames(config.plugins ?? [], env);
    const install = findInstall();
    // Only a global installation contributes its own directory. A project-local
    // CLI resolves the project's packages, which the project scope covers.
    const roots = [
        ...(install?.globalNodeModules ? [install.packageDir] : []),
        ...(config.pluginRoots ?? []).map(root => path.resolve(root)),
    ];

    const resolvePackage = (packageName: string) => {
        for (const root of roots) {
            const resolved = defaultResolvePackage(root, packageName);
            if (resolved) {
                return resolved;
            }
        }
        return null;
    };

    const checkResolvable = (packageName: string): string | undefined => {
        if (roots.length === 0) {
            return (
                `Listed in ${configPath} but there is nowhere to resolve it from: ` +
                '@vendure/cli is not installed globally here. Install it globally too, or add a ' +
                '"pluginRoots" entry naming the directory the package is installed in.'
            );
        }
        if (!resolvePackage(packageName)) {
            return (
                `Listed in ${configPath} but could not be resolved from ${roots.join(', ')}. ` +
                'Check that it is installed in the same place as @vendure/cli.'
            );
        }
        return undefined;
    };

    return {
        kind: 'global',
        origin: configPath,
        allowlist,
        resolvePackage,
        check: packageName =>
            checkResolvable(packageName) ?? checkDeclaresPlugin(packageName, resolvePackage),
        listCandidates: () =>
            install?.globalNodeModules ? listInstalledPackageNames(install.globalNodeModules) : [],
        error: error ? `Could not read ${configPath}: ${error}` : undefined,
    };
}

/**
 * The project scope, or `undefined` when there is no project package.json.
 */
function getProjectPluginScope(options: ResolveCliPluginsOptions): PluginScope | undefined {
    const context = getProjectPluginContext(options);
    if (!context) {
        return undefined;
    }
    return {
        kind: 'project',
        origin: context.projectRoot,
        allowlist: context.allowlist ?? [],
        resolvePackage: context.resolvePackage,
        check: packageName =>
            checkEnabledPluginStatically(packageName, context) ??
            checkDeclaresPlugin(packageName, context.resolvePackage),
        listCandidates: () => [...context.directDependencyOrigins.keys()],
    };
}

/**
 * Every scope to consider, in registration order.
 *
 * Global first, project last, so a project overrides the machine: commands
 * register in order, and among plugins that set `replaces: true` the last one
 * listed wins. The same package enabled in both scopes is loaded once, from the
 * project, since the project's copy is the one pinned to go with its code.
 */
function getPluginScopes(options: ResolveCliPluginsOptions): PluginScope[] {
    const scopes: PluginScope[] = [];
    const wanted = options.scopes ?? ALL_PLUGIN_SCOPES;
    const findInstall = options.findCliInstall ?? (() => findCliInstallLocation());

    if (wanted.includes('global')) {
        scopes.push(getGlobalPluginScope(options.env ?? process.env, findInstall));
    }
    if (wanted.includes('project')) {
        const projectScope = getProjectPluginScope(options);
        if (projectScope) {
            scopes.push(projectScope);
        }
    }
    return scopes;
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
    //
    // Deduplicated because a package listed twice is applied twice, and a
    // plugin that contributes no command has nothing to collide with the
    // second time. Its `afterConsoleLink` hook would then run twice per link,
    // repeating whatever setup that hook does.
    const allowlist = projectPackageJson.vendure?.cli?.plugins
        ? [...new Set(projectPackageJson.vendure.cli.plugins)]
        : undefined;

    const resolvePackage =
        options.resolvePackage ??
        ((packageName: string) =>
            defaultResolvePackage(directDependencyOrigins.get(packageName) ?? projectRoot, packageName));

    return { projectRoot, projectPackageJson, directDependencyOrigins, allowlist, resolvePackage };
}

/**
 * The project scope's eligibility rule: a listed package must be a direct
 * dependency and must resolve. Whether it then declares a usable plugin entry
 * is the same question in every scope, so {@link checkDeclaresPlugin} answers
 * that part for all of them.
 */
function checkEnabledPluginStatically(
    packageName: string,
    context: ProjectPluginContext,
): string | undefined {
    if (!context.directDependencyOrigins.has(packageName)) {
        return `Listed in vendure.cli.plugins but is not a direct dependency of ${context.projectRoot}`;
    }
    if (!context.resolvePackage(packageName)) {
        return `Listed in vendure.cli.plugins but could not be resolved from ${context.projectRoot}. Check that it is installed.`;
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
        const packageJsonPath = path.join(current, 'node_modules', ...packageName.split('/'), 'package.json');
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

/**
 * One scope, for the `plugins` command, so the checks it runs before writing
 * an allowlist are the same ones loading runs afterwards.
 */
export function getCliPluginScope(
    kind: CliPluginScopeKind,
    options: ResolveCliPluginsOptions = {},
): PluginScope | undefined {
    return getPluginScopes(options).find(scope => scope.kind === kind);
}
