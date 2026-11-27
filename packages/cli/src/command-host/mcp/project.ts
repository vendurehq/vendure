import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
    findWorkspacePackageJsonsWithDependency,
    hasWorkspaceMarker,
    MONOREPO_PACKAGE_DIRS,
} from '../../utilities/monorepo-utils.js';
import { compareCodeUnits } from '../naming.js';

/** The Vendure project the Developer MCP serves, found from a starting directory. */
export type McpProject =
    | { kind: 'found'; dir: string }
    | { kind: 'ambiguous'; root: string; candidates: string[] }
    | { kind: 'not-found' };

/**
 * Finds the Vendure project for `vendure mcp` and `vendure mcp install`. MCP clients start the
 * server in the folder they were opened in, which can be a subfolder of the project or the root of
 * a monorepo, so this walks up from `startDir`, and no further than the git root.
 *
 * It accepts a directory whose package.json depends on `@vendure/core`. At the git root, or at a
 * directory that declares workspaces, it also looks in the workspace members and in the package
 * folders, such as `apps/*` and `packages/*`. More than one project there is ambiguous, whichever
 * way the workspace is declared. Elsewhere it does not look, so a folder next to an unrelated
 * project is never taken for it. Paths are returned with symlinks resolved.
 */
export function findMcpProject(startDir: string): McpProject {
    let dir = fs.realpathSync(startDir);
    const gitRoot = findGitRoot(dir);
    for (;;) {
        if (dependsOnCore(dir)) {
            return { kind: 'found', dir };
        }
        if (dir === gitRoot || hasWorkspaceMarker(dir)) {
            const candidates = projectsBelow(dir);
            if (candidates.length === 1) {
                return { kind: 'found', dir: candidates[0] };
            }
            if (candidates.length > 1) {
                return { kind: 'ambiguous', root: dir, candidates };
            }
        }
        const parent = path.dirname(dir);
        if (dir === gitRoot || parent === dir) {
            return { kind: 'not-found' };
        }
        dir = parent;
    }
}

/**
 * The Vendure projects of a monorepo root: its workspace members, and the packages one level down
 * in the conventional package folders. The second covers workspaces that package.json does not
 * declare, such as pnpm's `pnpm-workspace.yaml`.
 */
function projectsBelow(root: string): string[] {
    const projects = new Set(
        findWorkspacePackageJsonsWithDependency(root, '@vendure/core').map(file => path.dirname(file)),
    );
    for (const group of MONOREPO_PACKAGE_DIRS) {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(path.join(root, group), { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const dir = path.join(root, group, entry.name);
            if (entry.isDirectory() && dependsOnCore(dir)) {
                projects.add(dir);
            }
        }
    }
    return [...new Set([...projects].map(dir => fs.realpathSync(dir)))].sort(compareCodeUnits);
}

function dependsOnCore(dir: string): boolean {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        return !!(
            packageJson.dependencies?.['@vendure/core'] ?? packageJson.devDependencies?.['@vendure/core']
        );
    } catch {
        return false;
    }
}

/**
 * The top directory of the git working tree `dir` is in, with symlinks resolved, or `undefined`
 * outside one: the nearest directory with a `.git` entry. In a git worktree, or a submodule, that
 * entry is a file, and the worktree's own directory is the top. Reading the directories, rather
 * than running git, needs no git on the PATH and prints nothing.
 */
export function findGitRoot(dir: string): string | undefined {
    let current = fs.realpathSync(dir);
    for (;;) {
        if (fs.existsSync(path.join(current, '.git'))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
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
