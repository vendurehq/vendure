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
        cli?: ProjectCliPluginConfig;
    };
}

export interface ResolvedCliPlugin {
    packageName: string;
    plugin: CliPlugin;
    entryPath: string;
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
 * Discovers and loads CLI plugins from the project's direct dependencies.
 */
export function resolveCliPlugins(options: ResolveCliPluginsOptions = {}): ResolvedCliPlugin[] {
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = options.projectPackageJson ? path.resolve(cwd) : resolveCliProjectRoot(cwd);
    const projectPackageJson =
        options.projectPackageJson ?? readPackageJson(path.join(projectRoot, 'package.json'));

    if (!projectPackageJson) {
        return [];
    }

    const cliConfig = projectPackageJson.vendure?.cli;
    const exclude = new Set(cliConfig?.exclude ?? []);
    const allowlist = cliConfig?.plugins && cliConfig.plugins.length > 0 ? cliConfig.plugins : undefined;
    const directDependencyNames = new Set(listDirectDependencyNames(projectPackageJson));

    if (allowlist) {
        const nonDirectPlugin = allowlist.find(packageName => !directDependencyNames.has(packageName));
        if (nonDirectPlugin) {
            throw new Error(
                `CLI plugin package "${nonDirectPlugin}" is listed in vendure.cli.plugins but is not a direct dependency of ${projectRoot}`,
            );
        }
    }

    const candidateNames = allowlist
        ? [...allowlist]
        : [...directDependencyNames].sort((a, b) => a.localeCompare(b));

    const resolvePackage =
        options.resolvePackage ?? ((packageName: string) => defaultResolvePackage(projectRoot, packageName));

    const loaded: ResolvedCliPlugin[] = [];

    for (const packageName of candidateNames) {
        if (exclude.has(packageName)) {
            continue;
        }

        const resolved = resolvePackage(packageName);
        if (!resolved) {
            if (allowlist) {
                throw new Error(
                    `CLI plugin package "${packageName}" listed in vendure.cli.plugins was not found from ${projectRoot}`,
                );
            }
            continue;
        }

        const entryRel = resolved.packageJson.vendure?.cliPlugin;
        if (!entryRel || typeof entryRel !== 'string') {
            if (allowlist) {
                throw new Error(
                    `CLI plugin package "${packageName}" does not declare vendure.cliPlugin in its package.json`,
                );
            }
            continue;
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
