import { createRequire } from 'node:module';
import path from 'node:path';

import { findVendureProjectRoot } from './project-validation';

/**
 * Loads a package from the project the CLI is being run against, rather than
 * from the CLI's own installation.
 *
 * Two reasons, one correctness and one practical.
 *
 * The correctness one: `generateMigration`, `preBootstrapConfig` and
 * `getFinalVendureSchema` behave differently between Vendure versions, and they
 * have to behave the way the project's own version does. Generating a migration
 * with a different `@vendure/core` than the one the server boots with produces a
 * migration for a schema the server does not have. The same goes for the config
 * singleton those functions read and write: the CLI and the project's
 * `vendure-config.ts` must reach the same instance of it, which they only do
 * when both resolve to the same copy of the package.
 *
 * The practical one: `@vendure/core` is a devDependency of `@vendure/cli`, not
 * a dependency, so it is never installed alongside a globally installed CLI.
 * A plain `require` resolves from the file doing the requiring, which for a
 * global install is somewhere under the global `node_modules`, so it cannot
 * see the project's copy however valid the project is.
 *
 * Both were previously masked by npm hoisting happening to put one copy where
 * the CLI's own lookup lands. Asking the project directly says what is meant
 * and stops depending on a layout the package manager is free to change.
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
