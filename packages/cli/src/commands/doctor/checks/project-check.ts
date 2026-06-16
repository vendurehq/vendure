import fs from 'fs-extra';
import path from 'node:path';

import { detectMonorepoStructure, findPackageJsonWithDependency } from '../../../utilities/monorepo-utils';
import { CheckResult } from '../types';

/**
 * Checks whether the current working directory is a valid Vendure project,
 * discovers the Vendure config file, and reports package manager and monorepo info.
 */
export async function runProjectCheck(configFlag?: string): Promise<CheckResult> {
    const cwd = process.cwd();
    const details: string[] = [];

    // 1. Check package.json exists
    const packageJsonPath = path.join(cwd, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return {
            name: 'Project',
            status: 'fail',
            message: 'No package.json found in the current directory',
            details: ['Run this command from the root of your Vendure project.'],
        };
    }

    // 2. Check for @vendure/* dependencies
    let packageJson: Record<string, any>;
    try {
        packageJson = fs.readJsonSync(packageJsonPath);
    } catch {
        return {
            name: 'Project',
            status: 'fail',
            message: 'Failed to parse package.json',
        };
    }

    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const vendureDeps = Object.keys(allDeps).filter(
        dep => dep.startsWith('@vendure/') || dep === 'vendure',
    );

    // If no vendure deps at root, check monorepo subdirectories
    let vendurePackageJsonPath: string | null = null;
    if (vendureDeps.length === 0) {
        vendurePackageJsonPath = findPackageJsonWithDependency(cwd, '@vendure/core');
        if (!vendurePackageJsonPath) {
            return {
                name: 'Project',
                status: 'fail',
                message: 'No @vendure/* dependencies found',
                details: [
                    'This does not appear to be a Vendure project.',
                    'Ensure @vendure/core is listed in your package.json dependencies.',
                ],
            };
        }
        details.push(`Vendure dependencies found at ${path.relative(cwd, vendurePackageJsonPath)}`);
    }

    // 3. Detect monorepo
    const monorepoInfo = detectMonorepoStructure(cwd);
    if (monorepoInfo.isMonorepo) {
        details.push(`Monorepo detected (${monorepoInfo.packageDir})`);
    }

    // 4. Detect package manager
    // In a monorepo, lockfiles live at the root, not in the subpackage
    const lockfileSearchDir = monorepoInfo.isMonorepo && monorepoInfo.root ? monorepoInfo.root : cwd;
    const packageManager = detectPackageManager(lockfileSearchDir);
    details.push(`Package manager: ${packageManager}`);

    // Check for lockfile consistency
    const lockfiles = detectLockfiles(lockfileSearchDir);
    if (lockfiles.length > 1) {
        details.push(`Warning: multiple lockfiles found (${lockfiles.join(', ')})`);
    } else if (lockfiles.length === 0) {
        details.push('No lockfile found');
    }

    // 5. Discover Vendure config file
    const configResult = discoverVendureConfig(cwd, configFlag);
    if (configResult.error) {
        return {
            name: 'Project',
            status: 'fail',
            message: configResult.error,
            details,
            packageManager,
        };
    }

    // 6. Report Node.js version
    details.push(`Node.js ${process.version}`);

    const message = configResult.path
        ? `Vendure config found at ${path.relative(cwd, configResult.path)}`
        : 'Vendure project detected';

    return {
        name: 'Project',
        status: 'pass',
        message,
        details,
        packageManager,
    };
}

function detectPackageManager(cwd: string): string {
    if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) {
        return 'bun';
    }
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
        return 'yarn';
    }
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(cwd, 'package-lock.json'))) {
        return 'npm';
    }
    return 'unknown';
}

function detectLockfiles(cwd: string): string[] {
    const lockfiles: string[] = [];
    if (fs.existsSync(path.join(cwd, 'package-lock.json'))) lockfiles.push('package-lock.json');
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) lockfiles.push('yarn.lock');
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) lockfiles.push('pnpm-lock.yaml');
    // bun.lockb (binary) and bun.lock (text) are both bun lockfiles -- count as one
    if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) {
        lockfiles.push('bun.lock');
    }
    return lockfiles;
}

interface ConfigDiscoveryResult {
    path?: string;
    error?: string;
}

/**
 * Discovers the Vendure config file. If `--config` is specified, uses that path.
 * Otherwise, checks common locations.
 */
function discoverVendureConfig(cwd: string, configFlag?: string): ConfigDiscoveryResult {
    if (configFlag) {
        const resolved = path.resolve(cwd, configFlag);
        if (fs.existsSync(resolved)) {
            return { path: resolved };
        }
        return { error: `Specified config file not found: ${configFlag}` };
    }

    const candidates = [
        'vendure-config.ts',
        'src/vendure-config.ts',
        'vendure-config.js',
        'src/vendure-config.js',
    ];

    const found: string[] = [];
    for (const candidate of candidates) {
        const fullPath = path.join(cwd, candidate);
        if (fs.existsSync(fullPath)) {
            found.push(fullPath);
        }
    }

    if (found.length === 1) {
        return { path: found[0] };
    }

    if (found.length > 1) {
        return {
            error:
                'Multiple Vendure config files found. Use --config to specify which one:\n' +
                found.map(f => `  - ${path.relative(cwd, f)}`).join('\n'),
        };
    }

    // No config at standard locations -- not necessarily an error for the project check,
    // but later checks that need the config will report this.
    return {};
}
