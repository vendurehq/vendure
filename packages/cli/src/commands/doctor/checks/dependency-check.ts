import fs from 'fs-extra';
import path from 'node:path';

import { CheckResult } from '../types';

/**
 * Known @vendure/* packages that use fixed versioning.
 * These should all be at the same version when installed.
 *
 * TODO: Consider deriving this list dynamically from the monorepo
 * or from a published registry to avoid manual maintenance.
 */
const VENDURE_PACKAGES = [
    '@vendure/admin-ui',
    '@vendure/admin-ui-plugin',
    '@vendure/asset-server-plugin',
    '@vendure/cli',
    '@vendure/common',
    '@vendure/core',
    '@vendure/create',
    '@vendure/dashboard',
    '@vendure/email-plugin',
    '@vendure/graphiql-plugin',
    '@vendure/harden-plugin',
    '@vendure/job-queue-plugin',
    '@vendure/sentry-plugin',
    '@vendure/telemetry-plugin',
    '@vendure/testing',
    '@vendure/ui-devkit',
];

/**
 * Dependencies that must not be duplicated in node_modules.
 * Multiple installed versions of these cause runtime identity bugs.
 */
const SINGLETON_PACKAGES = [
    'graphql',
    'typeorm',
    '@nestjs/core',
    '@nestjs/common',
    '@nestjs/graphql',
    '@nestjs/typeorm',
    '@apollo/server',
];

/**
 * Maps dbConnectionOptions.type to the required npm package.
 */
const DB_DRIVER_MAP: Record<string, string> = {
    mysql: 'mysql2',
    mariadb: 'mysql2',
    postgres: 'pg',
    'better-sqlite3': 'better-sqlite3',
    sqlite: 'better-sqlite3',
    sqljs: 'sql.js',
};

/**
 * Runs dependency checks:
 * 1. Detects mismatched @vendure/* package versions
 * 2. Detects duplicate singleton dependencies
 * 3. Verifies the configured DB driver is installed
 */
export async function runDependencyCheck(nodeModulesPath?: string): Promise<CheckResult> {
    const cwd = process.cwd();
    const modulesDir = nodeModulesPath ?? path.join(cwd, 'node_modules');
    const details: string[] = [];
    let worstStatus: 'pass' | 'warn' | 'fail' = 'pass';

    if (!fs.existsSync(modulesDir)) {
        return {
            name: 'Dependencies',
            status: 'fail',
            message: 'node_modules not found. Run your package manager install first.',
        };
    }

    // 1. Check @vendure/* version alignment
    const vendureVersions = getInstalledVendureVersions(modulesDir);
    if (vendureVersions.size > 0) {
        const versions = new Set(vendureVersions.values());
        if (versions.size > 1) {
            const grouped = groupByVersion(vendureVersions);
            // Check if it's only a patch mismatch (e.g. 3.6.3 vs 3.6.2) or a
            // minor/major mismatch (e.g. 3.7.0 vs 3.6.3). Patch mismatches are
            // unlikely to cause issues; minor/major mismatches can break things.
            const majorMinors = new Set(
                [...versions].map(v => v.split('.').slice(0, 2).join('.')),
            );
            if (majorMinors.size > 1) {
                worstStatus = 'fail';
                details.push('Mismatched @vendure/* package versions (minor/major):');
            } else {
                if (worstStatus === 'pass') worstStatus = 'warn';
                details.push('Mismatched @vendure/* package versions (patch):');
            }
            for (const [version, pkgs] of grouped) {
                details.push(`  ${version}: ${pkgs.join(', ')}`);
            }
        } else {
            const version = [...versions][0];
            details.push(`All @vendure/* packages at ${version}`);
        }
    }

    // 2. Check for duplicate singleton dependencies
    // Duplicates are a warning rather than a failure because in monorepos,
    // nested copies (e.g. msw bundling its own graphql) may not actually
    // cause runtime issues for the Vendure application.
    const duplicates = findDuplicatePackages(modulesDir, SINGLETON_PACKAGES);
    for (const [pkg, versions] of duplicates) {
        if (versions.length > 1) {
            if (worstStatus === 'pass') worstStatus = 'warn';
            details.push(`Multiple ${pkg} versions found: ${versions.join(', ')}`);
        }
    }
    if (duplicates.size === 0 || [...duplicates.values()].every(v => v.length <= 1)) {
        details.push('No duplicate singleton dependencies');
    }

    // 3. Check DB driver
    const dbDriverResult = checkDbDriver(cwd, modulesDir);
    if (dbDriverResult) {
        if (dbDriverResult.status === 'fail') {
            worstStatus = 'fail';
        } else if (dbDriverResult.status === 'warn' && worstStatus === 'pass') {
            worstStatus = 'warn';
        }
        details.push(dbDriverResult.message);
    }

    const message =
        worstStatus === 'pass'
            ? 'All dependency checks passed'
            : worstStatus === 'warn'
              ? 'Dependency warnings detected'
              : 'Dependency issues detected';

    return {
        name: 'Dependencies',
        status: worstStatus,
        message,
        details,
    };
}

/**
 * Reads installed @vendure/* package versions from node_modules.
 */
function getInstalledVendureVersions(modulesDir: string): Map<string, string> {
    const versions = new Map<string, string>();
    const vendureDir = path.join(modulesDir, '@vendure');
    if (!fs.existsSync(vendureDir)) {
        return versions;
    }

    for (const pkg of VENDURE_PACKAGES) {
        const pkgJsonPath = path.join(modulesDir, pkg, 'package.json');
        const version = readPackageVersion(pkgJsonPath);
        if (version) {
            versions.set(pkg, version);
        }
    }
    return versions;
}

/**
 * Finds duplicate installations of packages by scanning nested node_modules.
 * Returns a map of package name -> list of installed versions.
 */
function findDuplicatePackages(
    modulesDir: string,
    packages: string[],
): Map<string, string[]> {
    const result = new Map<string, string[]>();

    for (const pkg of packages) {
        const versions = new Set<string>();

        // Check root node_modules
        const rootVersion = readPackageVersion(path.join(modulesDir, pkg, 'package.json'));
        if (rootVersion) {
            versions.add(rootVersion);
        }

        // Scan for nested copies in node_modules/*/node_modules/<pkg>
        // and node_modules/@*/*/node_modules/<pkg>
        const nestedVersions = findNestedPackageVersions(modulesDir, pkg);
        for (const v of nestedVersions) {
            versions.add(v);
        }

        if (versions.size > 0) {
            result.set(pkg, [...versions].sort());
        }
    }

    return result;
}

/**
 * Scans nested node_modules directories for additional installations of a package.
 * Checks up to 2 levels deep to catch common duplication patterns.
 */
function findNestedPackageVersions(modulesDir: string, targetPkg: string): string[] {
    const versions: string[] = [];

    let entries: string[];
    try {
        entries = fs.readdirSync(modulesDir);
    } catch {
        return versions;
    }

    for (const entry of entries) {
        // Skip the target package itself and hidden directories (.pnpm, .cache, etc.).
        // pnpm's content-addressable store (.pnpm) doesn't need direct scanning because
        // pnpm symlinks packages into standard node_modules locations, and Node's fs
        // operations follow symlinks transparently. Scanning .pnpm directly would produce
        // false positives since every package appears there by design.
        if (entry === targetPkg || entry.startsWith('.')) continue;

        const entryPath = path.join(modulesDir, entry);

        if (entry.startsWith('@')) {
            // Scoped packages: check @scope/pkg/node_modules/<target>
            let scopedEntries: string[];
            try {
                scopedEntries = fs.readdirSync(entryPath);
            } catch {
                continue;
            }
            for (const scopedEntry of scopedEntries) {
                const nestedModules = path.join(entryPath, scopedEntry, 'node_modules');
                const nestedPkgJson = path.join(nestedModules, targetPkg, 'package.json');
                const version = readPackageVersion(nestedPkgJson);
                if (version) {
                    versions.push(version);
                }
            }
        } else {
            // Regular packages: check pkg/node_modules/<target>
            const nestedModules = path.join(entryPath, 'node_modules');
            const nestedPkgJson = path.join(nestedModules, targetPkg, 'package.json');
            const version = readPackageVersion(nestedPkgJson);
            if (version) {
                versions.push(version);
            }
        }
    }

    return versions;
}

/**
 * Reads the version field from a package.json file.
 * Returns undefined if the file doesn't exist or can't be parsed.
 */
function readPackageVersion(pkgJsonPath: string): string | undefined {
    try {
        if (!fs.existsSync(pkgJsonPath)) return undefined;
        const pkg = fs.readJsonSync(pkgJsonPath);
        return pkg.version;
    } catch {
        return undefined;
    }
}

/**
 * Groups packages by their version for readable output.
 */
function groupByVersion(packages: Map<string, string>): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const [pkg, version] of packages) {
        const existing = grouped.get(version) ?? [];
        existing.push(pkg);
        grouped.set(version, existing);
    }
    return grouped;
}

/**
 * Checks if the correct database driver package is installed for the configured DB type.
 * Reads dbConnectionOptions.type from the project's vendure config or package.json.
 */
function checkDbDriver(
    cwd: string,
    modulesDir: string,
): { status: 'pass' | 'warn' | 'fail'; message: string } | null {
    // Try to detect the DB type from the project's vendure config
    // We can't import the config here (that's Check 3's job), so we do a simple
    // text-based scan of common config files for the dbConnectionOptions.type value.
    const dbType = detectDbTypeFromSource(cwd);
    if (!dbType) {
        return null; // Can't determine DB type -- skip this sub-check
    }

    const driverPkg = DB_DRIVER_MAP[dbType];
    if (!driverPkg) {
        return {
            status: 'warn',
            message: `Unknown database type: ${dbType}`,
        };
    }

    const driverPath = path.join(modulesDir, driverPkg, 'package.json');
    if (fs.existsSync(driverPath)) {
        const version = readPackageVersion(driverPath);
        return {
            status: 'pass',
            message: `DB driver ${driverPkg}${version ? ` (${version})` : ''} installed for type "${dbType}"`,
        };
    }

    return {
        status: 'fail',
        message: `DB driver "${driverPkg}" not installed (required for dbConnectionOptions.type: "${dbType}")`,
    };
}

/**
 * Attempts to detect the database type by scanning source files for
 * dbConnectionOptions configuration. This is a lightweight text-based scan
 * that avoids importing the config (which requires ts-node setup).
 */
function detectDbTypeFromSource(cwd: string): string | undefined {
    const candidates = [
        'vendure-config.ts',
        'src/vendure-config.ts',
        'vendure-config.js',
        'src/vendure-config.js',
        'dev-config.ts',
        'src/dev-config.ts',
    ];

    for (const candidate of candidates) {
        const filePath = path.join(cwd, candidate);
        if (!fs.existsSync(filePath)) continue;

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            // Match type within dbConnectionOptions block
            const dbBlockMatch = content.match(/dbConnectionOptions\s*[:{][\s\S]*?type\s*:\s*['"]([^'"]+)['"]/);
            if (dbBlockMatch) {
                return dbBlockMatch[1];
            }
        } catch {
            continue;
        }
    }

    return undefined;
}
