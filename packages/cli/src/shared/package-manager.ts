import fs from 'fs-extra';
import path from 'node:path';

import { walkUp } from './project-validation';

export type PackageManager = 'bun' | 'yarn' | 'pnpm' | 'npm';

/**
 * The package manager whose lockfile is in `dir`, or `undefined` when there is
 * none. bun.lockb (binary) and bun.lock (text) are both bun lockfiles.
 */
export function detectPackageManagerIn(dir: string): PackageManager | undefined {
    if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) {
        return 'bun';
    }
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
        return 'yarn';
    }
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(dir, 'package-lock.json'))) {
        return 'npm';
    }
    return undefined;
}

/**
 * The package manager a project uses, from the nearest lockfile at or above
 * `projectDir`. Walks up because a workspace member's lockfile is at the
 * workspace root. npm when there is no lockfile at all.
 */
export function detectProjectPackageManager(projectDir: string): PackageManager {
    let found: PackageManager | undefined;
    walkUp(projectDir, dir => {
        found = detectPackageManagerIn(dir);
        return found !== undefined;
    });
    return found ?? 'npm';
}

/**
 * The command that adds `packageName` to the devDependencies of the project in `projectDir`.
 * pnpm refuses to add to a workspace root unless told to with `-w`.
 */
export function addDevDependencyCommand(projectDir: string, packageName: string): string {
    const packageManager = detectProjectPackageManager(projectDir);
    if (packageManager === 'npm') {
        return `npm install -D ${packageName}`;
    }
    const workspaceRoot =
        packageManager === 'pnpm' && fs.existsSync(path.join(projectDir, 'pnpm-workspace.yaml'));
    return `${packageManager} add -D${workspaceRoot ? ' -w' : ''} ${packageName}`;
}
