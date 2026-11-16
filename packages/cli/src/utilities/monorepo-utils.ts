import fs from 'fs-extra';
import path from 'node:path';

/**
 * Common monorepo directory names (e.g., Nx, Turborepo, Lerna conventions)
 * - packages: Most common, used by most tools for shared libraries
 * - apps: Turborepo/Nx convention for applications
 * - libs: Nx convention for libraries
 * - services: Common for backend services/microservices
 * - modules: Alternative to packages (some projects prefer this naming)
 */
export const MONOREPO_PACKAGE_DIRS = ['packages', 'apps', 'libs', 'services', 'modules'] as const;

export interface MonorepoInfo {
    isMonorepo: boolean;
    /**
     * The root directory of the monorepo (if in a monorepo)
     */
    root?: string;
    /**
     * The package directory name that contains this path (e.g., 'packages', 'apps', 'libs')
     */
    packageDir?: (typeof MONOREPO_PACKAGE_DIRS)[number];
}

/**
 * Detects if a given path is inside a monorepo structure and extracts the monorepo root.
 * Handles cases where multiple monorepo directory types exist (e.g., both 'apps' and 'libs').
 *
 * @example
 * detectMonorepoStructure('/monorepo/packages/backend')
 * // => { isMonorepo: true, root: '/monorepo', packageDir: 'packages' }
 *
 * detectMonorepoStructure('/monorepo/apps/frontend')
 * // => { isMonorepo: true, root: '/monorepo', packageDir: 'apps' }
 *
 * detectMonorepoStructure('/regular-project')
 * // => { isMonorepo: false }
 */
export function detectMonorepoStructure(dirPath: string): MonorepoInfo {
    const normalizedPath = path.normalize(dirPath);

    for (const dir of MONOREPO_PACKAGE_DIRS) {
        const pattern = path.sep + dir + path.sep;
        if (normalizedPath.includes(pattern)) {
            // Extract the monorepo root (the part before /packages/, /apps/, or /libs/)
            const parts = normalizedPath.split(pattern);
            return {
                isMonorepo: true,
                root: parts[0],
                packageDir: dir,
            };
        }
    }

    return { isMonorepo: false };
}

/**
 * Searches for a package.json file with a specific dependency within monorepo structures.
 * Checks the root package, declared workspace members, then common monorepo directories.
 * Returns the first package.json with the specified dependency.
 *
 * @param rootDir - The root directory to search from
 * @param dependencyName - The dependency name to look for (e.g., '@vendure/core')
 * @returns The path to the package.json file, or null if not found
 */
export function findPackageJsonWithDependency(rootDir: string, dependencyName: string): string | null {
    // First check if the root package.json has the dependency
    const rootPackageJsonPath = path.join(rootDir, 'package.json');
    if (hasNamedDependency(rootPackageJsonPath, dependencyName)) {
        return rootPackageJsonPath;
    }

    const workspacePackages = findWorkspacePackageJsonsWithDependency(rootDir, dependencyName);
    if (workspacePackages.length > 0) {
        return workspacePackages[0];
    }

    // Search in monorepo package directories
    for (const dir of MONOREPO_PACKAGE_DIRS) {
        const monorepoDir = path.join(rootDir, dir);
        if (fs.existsSync(monorepoDir)) {
            for (const subDir of fs.readdirSync(monorepoDir)) {
                const packageJsonPath = path.join(monorepoDir, subDir, 'package.json');
                if (hasNamedDependency(packageJsonPath, dependencyName)) {
                    return packageJsonPath;
                }
            }
        }
    }

    return null;
}

/**
 * Finds workspace members with the specified dependency. Supports array and object workspace
 * declarations, with `*` wildcards in path segments. Overlapping patterns return each member once.
 */
export function findWorkspacePackageJsonsWithDependency(rootDir: string, dependencyName: string): string[] {
    let workspaces: string[] | { packages?: string[] } | undefined;
    try {
        workspaces = fs.readJsonSync(path.join(rootDir, 'package.json')).workspaces;
    } catch {
        return [];
    }
    const patterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
    if (!Array.isArray(patterns)) {
        return [];
    }
    const packages = new Set<string>();
    for (const pattern of patterns) {
        let directories = [path.resolve(rootDir)];
        for (const segment of pattern.split('/').filter(Boolean)) {
            directories = directories.flatMap(dir => {
                if (!segment.includes('*')) {
                    const candidate = path.resolve(dir, segment);
                    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
                        ? [candidate]
                        : [];
                }
                const matcher = new RegExp(
                    '^' +
                        segment
                            .split('*')
                            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
                            .join('.*') +
                        '$',
                );
                return fs
                    .readdirSync(dir, { withFileTypes: true })
                    .filter(entry => {
                        if (!matcher.test(entry.name)) {
                            return false;
                        }
                        const candidate = path.join(dir, entry.name);
                        return (
                            entry.isDirectory() ||
                            (entry.isSymbolicLink() &&
                                fs.existsSync(candidate) &&
                                fs.statSync(candidate).isDirectory())
                        );
                    })
                    .map(entry => path.join(dir, entry.name));
            });
        }
        for (const dir of directories) {
            const packageJsonPath = path.join(dir, 'package.json');
            if (hasNamedDependency(packageJsonPath, dependencyName)) {
                packages.add(packageJsonPath);
            }
        }
    }
    return [...packages].sort((a, b) => a.localeCompare(b));
}

/**
 * Lists the directories under `cwd` that likely hold the Vendure project: workspace members
 * (the discovery `vendure dev` uses) and direct child directories with an `@vendure/core`
 * dependency. Returns paths relative to `cwd`, sorted and without duplicates.
 */
export function findProjectDirectoryHints(cwd: string): string[] {
    const directories = new Set(
        findWorkspacePackageJsonsWithDependency(cwd, '@vendure/core').map(file => path.dirname(file)),
    );
    try {
        for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
            const child = path.join(cwd, entry.name);
            if (
                entry.name !== 'node_modules' &&
                !entry.name.startsWith('.') &&
                entry.isDirectory() &&
                hasNamedDependency(path.join(child, 'package.json'), '@vendure/core')
            ) {
                directories.add(child);
            }
        }
    } catch {
        // An unreadable directory has no hints.
    }
    return [...directories].map(dir => path.relative(cwd, dir)).sort((a, b) => a.localeCompare(b));
}

/** A workspace has multiple Core projects and needs an explicit selection. */
export class AmbiguousVendureProjectError extends Error {}

/**
 * Resolves a Core project from an explicit path, the current package, workspace members or
 * conventional monorepo directories. Rejects ambiguous workspace members.
 */
export function resolveCoreProjectDirectory(cwd: string, project?: string): string {
    if (project !== undefined) {
        const projectDir = path.resolve(cwd, project);
        if (!hasNamedDependency(path.join(projectDir, 'package.json'), '@vendure/core')) {
            throw new Error(
                `Invalid --project directory "${projectDir}". Expected a package.json with an @vendure/core dependency.`,
            );
        }
        return projectDir;
    }
    if (hasNamedDependency(path.join(cwd, 'package.json'), '@vendure/core')) {
        return cwd;
    }

    const workspacePackages = findWorkspacePackageJsonsWithDependency(cwd, '@vendure/core');
    if (workspacePackages.length > 1) {
        const candidates = workspacePackages.map(file => path.relative(cwd, path.dirname(file)));
        throw new AmbiguousVendureProjectError(
            `Multiple Vendure projects found in "${cwd}": ${candidates.join(', ')}. Use --project <dir> to select one.`,
        );
    }
    const packageJsonPath = workspacePackages[0] ?? findPackageJsonWithDependency(cwd, '@vendure/core');
    if (!packageJsonPath) {
        throw new Error(
            `No Vendure project found in "${cwd}". Use --project <dir> to select a project directory.`,
        );
    }
    return path.dirname(packageJsonPath);
}

/**
 * Checks if a package.json file exists and has the specified dependency.
 */
function hasNamedDependency(packageJsonPath: string, dependencyName: string): boolean {
    if (!fs.existsSync(packageJsonPath)) {
        return false;
    }
    try {
        const packageJson = fs.readJsonSync(packageJsonPath);
        return !!(
            packageJson.dependencies?.[dependencyName] ?? packageJson.devDependencies?.[dependencyName]
        );
    } catch {
        return false;
    }
}

/**
 * Finds tsconfig files in a directory, preferring 'tsconfig.json' if it exists.
 */
export function findTsConfigInDir(dir: string): string | null {
    if (!fs.existsSync(dir)) {
        return null;
    }

    const tsConfigCandidates = fs.readdirSync(dir).filter(f => /^tsconfig.*\.json$/.test(f));

    if (tsConfigCandidates.includes('tsconfig.json')) {
        return path.join(dir, 'tsconfig.json');
    }

    if (tsConfigCandidates.length > 0) {
        return path.join(dir, tsConfigCandidates[0]);
    }

    return null;
}

/**
 * Checks if a directory has a workspace configuration marker file,
 * confirming it is genuinely a monorepo/workspace root.
 * Checks for pnpm-workspace.yaml, lerna.json, nx.json, turbo.json,
 * or a "workspaces" field in package.json (npm/yarn workspaces).
 */
export function hasWorkspaceMarker(dir: string): boolean {
    const markers = ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json'];
    for (const marker of markers) {
        if (fs.existsSync(path.join(dir, marker))) {
            return true;
        }
    }
    try {
        const pkg = fs.readJsonSync(path.join(dir, 'package.json'));
        if (pkg.workspaces) {
            return true;
        }
    } catch {
        // no package.json or unreadable
    }
    return false;
}
