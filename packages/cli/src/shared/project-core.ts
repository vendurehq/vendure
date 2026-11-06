import { createRequire } from 'node:module';
import path from 'node:path';

import { findVendureProjectRoot } from './project-validation';

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
        throw new Error(
            `Could not load "${packageName}" from ${projectRoot}.\n` +
                'This command uses the version installed in your project, not the one bundled with the CLI. ' +
                `Check that "${packageName}" is installed there, and that dependencies have been installed.\n` +
                `Cause: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
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
