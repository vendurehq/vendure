import { createRequire } from 'node:module';
import path from 'node:path';

import { findVendureProjectRoot } from './project-validation.js';

/**
 * Loads a package from the project the CLI is being run against, rather than
 * from the CLI's own installation.
 *
 * `generateMigration`, `preBootstrapConfig` and `getFinalVendureSchema` behave
 * differently between Vendure versions, and have to behave the way the
 * project's version does: a migration generated against a different
 * `@vendure/core` describes a schema the server does not have. Those functions
 * also read and write a config singleton held inside the package, and the
 * project's `vendure-config.ts` is compiled against the copy installed in the
 * project, so the two must reach the same instance of it.
 *
 * `@vendure/core` is also a devDependency of `@vendure/cli` rather than a
 * dependency, so it is not installed alongside a global CLI. A plain `require`
 * resolves from the file requiring it, which for a global install can never
 * see the project's copy.
 */
export function requireFromProject<T = unknown>(packageName: string, cwd?: string): T {
    const projectRoot = findVendureProjectRoot(cwd) ?? path.resolve(cwd ?? process.cwd());
    const requireFromProjectRoot = createRequire(path.join(projectRoot, 'package.json'));
    try {
        return requireFromProjectRoot(packageName) as T;
    } catch (e) {
        throw projectLoadError(packageName, projectRoot, e);
    }
}

/**
 * Loads a package that `@vendure/core` depends on, such as `typeorm`, `graphql`
 * or `@nestjs/graphql`, resolving it from the project's `@vendure/core` rather
 * than from the project root.
 *
 * Use this instead of {@link requireFromProject} for any package in core's own
 * dependencies. The project does not have to list those packages itself, so a
 * package manager may install them only under `@vendure/core`: nested inside
 * its `node_modules`, or beside it in a strict layout such as pnpm's. Resolving
 * from core also returns the same copy that core uses at runtime, which matters
 * when a second copy sits at the project root.
 */
export function requireFromProjectCore<T = unknown>(packageName: string, cwd?: string): T {
    const projectRoot = findVendureProjectRoot(cwd) ?? path.resolve(cwd ?? process.cwd());
    const requireFromProjectRoot = createRequire(path.join(projectRoot, 'package.json'));
    let corePackageJson: string;
    try {
        corePackageJson = requireFromProjectRoot.resolve('@vendure/core/package.json');
    } catch (e) {
        throw projectLoadError('@vendure/core', projectRoot, e);
    }
    try {
        return createRequire(corePackageJson)(packageName) as T;
    } catch (e) {
        throw projectLoadError(packageName, projectRoot, e);
    }
}

function projectLoadError(packageName: string, projectRoot: string, cause: unknown): Error {
    return new Error(
        `Could not load "${packageName}" from ${projectRoot}.\n` +
            'This command uses the version installed in your project, not the one bundled with the CLI. ' +
            `Check that "${packageName}" is installed there, and that dependencies have been installed.\n` +
            `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
}

/**
 * The project's `@vendure/core`. See {@link requireFromProject}.
 *
 * Typed through `import type`, which is erased at compile time, so naming the
 * module here does not make the CLI require it at startup.
 */
export function requireProjectCore(cwd?: string): typeof import('@vendure/core') {
    return requireFromProject<typeof import('@vendure/core')>('@vendure/core', cwd);
}

let runningInCliDepth = 0;
let runningInCliBefore: string | undefined;

/**
 * Runs a function of the project's `@vendure/core` with `VENDURE_RUNNING_IN_CLI` set. With it,
 * core's migration functions print nothing, and throw instead of setting an exit code. Calls may
 * overlap, as in a test that runs commands in parallel: the variable stays set until the last one
 * ends, and is then restored to the value it had before the first.
 */
export async function withCoreRunningInCli<T>(fn: () => Promise<T>): Promise<T> {
    if (runningInCliDepth === 0) {
        runningInCliBefore = process.env.VENDURE_RUNNING_IN_CLI;
    }
    runningInCliDepth++;
    process.env.VENDURE_RUNNING_IN_CLI = 'true';
    try {
        return await fn();
    } finally {
        runningInCliDepth--;
        if (runningInCliDepth === 0) {
            if (runningInCliBefore === undefined) {
                delete process.env.VENDURE_RUNNING_IN_CLI;
            } else {
                process.env.VENDURE_RUNNING_IN_CLI = runningInCliBefore;
            }
        }
    }
}
