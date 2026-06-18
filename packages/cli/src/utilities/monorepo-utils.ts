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
 * Searches common monorepo directories (packages, apps, libs) for subdirectories containing
 * a package.json with the specified dependency.
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
 * Checks if a package.json file exists and has the specified dependency.
 */
function hasNamedDependency(packageJsonPath: string, dependencyName: string): boolean {
    if (!fs.existsSync(packageJsonPath)) {
        return false;
    }
    try {
        const packageJson = fs.readJsonSync(packageJsonPath);
        return !!packageJson.dependencies?.[dependencyName];
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
