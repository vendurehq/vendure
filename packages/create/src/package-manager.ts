import { CREATE_RECORD_PACKAGE_MANAGERS } from '@vendure/common/lib/create-record';

import { CreateError } from './errors.js';
import { PackageManager } from './types.js';

export const PACKAGE_MANAGERS = CREATE_RECORD_PACKAGE_MANAGERS;

/**
 * Detects the package manager used to invoke this CLI from the
 * `npm_config_user_agent` env var that npm/yarn/pnpm/bun all set when running a
 * package's bin. Falls back to npm. This is what lets `bunx @vendure/create`
 * (and the pnpm/yarn equivalents) install with a package manager that is
 * actually on the PATH.
 */
export function detectPackageManager(
    userAgent: string | undefined = process.env.npm_config_user_agent,
): PackageManager {
    const name = userAgent?.split(' ')[0]?.split('/')[0];
    if (name === 'yarn' || name === 'pnpm' || name === 'bun') {
        return name;
    }
    return 'npm';
}

export function parsePackageManager(value: string): PackageManager {
    const name = value.toLowerCase();
    if (!(PACKAGE_MANAGERS as readonly string[]).includes(name)) {
        throw new CreateError(
            'create.package-manager-unknown',
            `Unknown package manager "${value}".`,
            `Use one of ${PACKAGE_MANAGERS.join(', ')}.`,
        );
    }
    return name as PackageManager;
}

/**
 * Manager-specific command fragments for the generated package.json scripts, the README, the
 * agent instructions and the `next` commands, so they match the manager the project was created
 * with.
 */
export interface PackageManagerInfo {
    name: PackageManager;
    /** Prefix to run a package.json script, e.g. `npm run` / `pnpm run` / `bun run`. */
    runScript: string;
    /** Prefix to execute a locally-installed bin, e.g. `npx` / `bunx` / `pnpm exec`. */
    exec: string;
    /** Install all deps declared in the manifest, e.g. `npm install` / `pnpm install`. */
    install: string;
    /**
     * Whether the manager reads the package.json `workspaces` field (npm/yarn/bun) or
     * requires a `pnpm-workspace.yaml` (pnpm).
     */
    usesPackageJsonWorkspaces: boolean;
    /** Build a command to run a script in a named workspace, e.g. `npm run dev -w server`. */
    workspaceScript(workspace: string, script: string): string;
}

export function getPackageManagerInfo(packageManager: PackageManager): PackageManagerInfo {
    switch (packageManager) {
        case 'yarn':
            return {
                name: 'yarn',
                runScript: 'yarn run',
                exec: 'yarn',
                install: 'yarn install',
                usesPackageJsonWorkspaces: true,
                workspaceScript: (workspace, script) => `yarn workspace ${workspace} ${script}`,
            };
        case 'pnpm':
            return {
                name: 'pnpm',
                runScript: 'pnpm run',
                exec: 'pnpm exec',
                install: 'pnpm install',
                usesPackageJsonWorkspaces: false,
                workspaceScript: (workspace, script) => `pnpm --filter ${workspace} ${script}`,
            };
        case 'bun':
            return {
                name: 'bun',
                runScript: 'bun run',
                exec: 'bunx',
                install: 'bun install',
                usesPackageJsonWorkspaces: true,
                workspaceScript: (workspace, script) => `bun run --filter ${workspace} ${script}`,
            };
        default:
            return {
                name: 'npm',
                runScript: 'npm run',
                exec: 'npx',
                install: 'npm install',
                usesPackageJsonWorkspaces: true,
                workspaceScript: (workspace, script) => `npm run ${script} -w ${workspace}`,
            };
    }
}
