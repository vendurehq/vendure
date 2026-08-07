import path from 'node:path';

/**
 * Name of the directory (under the consuming project's `node_modules/.cache`)
 * into which the VendureConfig is compiled for introspection during the
 * dashboard build.
 */
export const TEMP_COMPILATION_DIR_NAME = 'vendure-dashboard-temp';

/**
 * Resolves the default directory into which the VendureConfig is transpiled (to
 * CommonJS) and dynamically imported during the dashboard build.
 *
 * This deliberately does NOT live inside the `@vendure/dashboard` package.
 * When the config contains a local import from above its own directory (e.g.
 * `import { x } from '../shared/util.js'`), the compiler emits the resolved
 * file one level above `outputPath`, escaping the compiler-written
 * `{"type":"commonjs"}` guard. Node then resolves the emitted `.js` against
 * the nearest `package.json` — which, inside `@vendure/dashboard`, declares
 * `"type": "module"` — and loading throws
 * `ReferenceError: exports is not defined in ES module scope`. See
 * https://github.com/vendurehq/vendure/issues/4979.
 *
 * Placing the output under the consuming project's `node_modules/.cache` keeps
 * module resolution intact (the compiled config can still resolve
 * `@vendure/core` and friends) while ensuring it is not inside a `type: module`
 * package. The location can still be overridden via the `tempCompilationDir`
 * plugin option.
 */
export function getDefaultTempCompilationDir(cwd: string = process.cwd()): string {
    return path.join(cwd, 'node_modules', '.cache', TEMP_COMPILATION_DIR_NAME);
}
