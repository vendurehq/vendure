import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { walkUp } from '../../shared/project-validation.js';
import {
    AmbiguousVendureProjectError,
    findWorkspacePackageJsonsWithDependency,
    resolveCoreProjectDirectory,
} from '../../utilities/monorepo-utils.js';

/** The Vendure project the Developer MCP serves, found from a starting directory. */
export type McpProject =
    | { kind: 'found'; dir: string }
    | { kind: 'ambiguous'; root: string; candidates: string[] }
    | { kind: 'not-found' };

/**
 * Finds the Vendure project for `vendure mcp` and `vendure mcp install`. MCP clients start the
 * server in the folder they were opened in, which can be a subfolder of the project or the root of
 * a monorepo, so this walks up from `startDir`. At each directory it accepts a package with an
 * `@vendure/core` dependency, or a monorepo root whose workspace members or package folders hold
 * one, as `vendure dev` resolves them.
 */
export function findMcpProject(startDir: string): McpProject {
    let ambiguous: McpProject | undefined;
    const dir = walkUp(startDir, candidate => {
        try {
            resolveCoreProjectDirectory(candidate);
            return true;
        } catch (e) {
            if (e instanceof AmbiguousVendureProjectError) {
                const candidates = findWorkspacePackageJsonsWithDependency(candidate, '@vendure/core').map(
                    file => path.dirname(file),
                );
                ambiguous = { kind: 'ambiguous', root: candidate, candidates };
                return true;
            }
            return false;
        }
    });
    if (ambiguous) {
        return ambiguous;
    }
    return dir ? { kind: 'found', dir: resolveCoreProjectDirectory(dir) } : { kind: 'not-found' };
}

/** The `@vendure/cli` that Node resolves from a directory, as `npx` uses it from there. */
export interface ResolvedCli {
    /** The package directory, with symlinks resolved. */
    dir: string;
    version: string;
    /** The absolute path of the `vendure` binary. */
    bin: string;
}

/** The `@vendure/cli` a directory resolves through `node_modules`, or `undefined` when there is none. */
export function resolveCliFrom(dir: string): ResolvedCli | undefined {
    let packageJsonPath: string;
    try {
        packageJsonPath = createRequire(path.join(dir, 'noop.js')).resolve('@vendure/cli/package.json');
    } catch {
        return undefined;
    }
    const packageDir = fs.realpathSync(path.dirname(packageJsonPath));
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
        version: string;
        bin?: string | Record<string, string>;
    };
    const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.vendure;
    return {
        dir: packageDir,
        version: packageJson.version,
        bin: path.join(packageDir, bin ?? 'dist/cli.js'),
    };
}

/** The result of checking that `vendure mcp` runs from the project's own `@vendure/cli`. */
export type ProjectCliCheck =
    | { ok: true }
    | { ok: false; reason: 'not-installed'; project: string; running: string; runningVersion: string }
    | {
          ok: false;
          reason: 'other-cli';
          project: string;
          running: string;
          runningVersion: string;
          local: ResolvedCli;
      };

/**
 * Checks that the running CLI is the one the project installs. `npx --no` runs a globally
 * installed `@vendure/cli` when the folder it was started in has none, and an old global version
 * would serve the wrong commands. `runningDir` is the package directory of the running CLI.
 */
export function checkProjectCli(
    projectDir: string,
    runningDir: string,
    runningVersion: string,
): ProjectCliCheck {
    const local = resolveCliFrom(projectDir);
    const running = fs.realpathSync(runningDir);
    if (!local) {
        return { ok: false, reason: 'not-installed', project: projectDir, running, runningVersion };
    }
    if (local.dir !== running) {
        return { ok: false, reason: 'other-cli', project: projectDir, running, runningVersion, local };
    }
    return { ok: true };
}
