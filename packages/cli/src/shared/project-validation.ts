import * as fs from 'fs-extra';
import path from 'node:path';

/**
 * Checks if the current working directory is a valid Vendure project directory.
 * This function centralizes the project validation logic used across CLI commands.
 */
export function isVendureProjectDirectory(): boolean {
    const cwd = process.cwd();

    const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
    const hasVendureConfig =
        fs.existsSync(path.join(cwd, 'vendure-config.ts')) ||
        fs.existsSync(path.join(cwd, 'vendure-config.js')) ||
        fs.existsSync(path.join(cwd, 'src/vendure-config.ts')) ||
        fs.existsSync(path.join(cwd, 'src/vendure-config.js'));

    if (hasPackageJson) {
        try {
            return hasVendureDependency(path.join(cwd, 'package.json')) && hasVendureConfig;
        } catch {
            return false;
        }
    }

    return false;
}

export function validateVendureProjectDirectory(): void {
    if (!isVendureProjectDirectory()) {
        throw new Error(
            'Error: Not in a Vendure project directory. Please run this command from your Vendure project root.',
        );
    }
}

const VENDURE_PACKAGE_SCOPE = '@vendure/';
const VENDURE_PACKAGE_NAME = 'vendure';

/**
 * Finds the nearest directory at or above `cwd` whose package.json depends on
 * a Vendure package, or `undefined` when there is none.
 *
 * This answers a deliberately loose question: is the user standing anywhere
 * inside a Vendure project? That is what separates running a globally
 * installed CLI from a home directory, where no project command can do
 * anything useful, from running it inside a project. It is not a promise that
 * any particular command can succeed, so a command with stricter needs — a
 * config file in the current directory, a tsconfig, an installed
 * `@vendure/core` — still checks for itself. Compare
 * {@link isVendureProjectDirectory}, which asks the stricter question about
 * the current directory alone.
 *
 * Walking up means the check passes from a subdirectory of a project, which is
 * where a developer often is.
 */
export function findVendureProjectRoot(cwd: string = process.cwd()): string | undefined {
    return walkUp(cwd, dir => hasVendureDependency(path.join(dir, 'package.json')));
}

/**
 * Walks from `startDir` towards the filesystem root, returning the first
 * directory the predicate accepts.
 *
 * Shared because the loop is easy to write and easy to write wrongly: the exit
 * condition is `path.dirname` returning its own argument, which is how the root
 * reports having no parent, and a `while (true)` that omits it does not
 * terminate.
 */
export function walkUp(startDir: string, accept: (dir: string) => boolean): string | undefined {
    let current = path.resolve(startDir);
    while (true) {
        if (accept(current)) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

/**
 * Whether a package.json depends on Vendure at all.
 *
 * Any dependency in the Vendure scope counts, rather than one named package,
 * because which Vendure packages are installed varies between a server, a
 * monorepo workspace and a plugin repo. The unscoped `vendure` name is the
 * starter package, which a project created from the starter depends on.
 */
function hasVendureDependency(packageJsonPath: string): boolean {
    if (!fs.existsSync(packageJsonPath)) {
        return false;
    }
    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const names = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
        return names.some(name => name === VENDURE_PACKAGE_NAME || name.startsWith(VENDURE_PACKAGE_SCOPE));
    } catch {
        return false;
    }
}

/**
 * What the host writes when a command that needs a project is run outside one.
 *
 * Names the directory that was searched, because the usual cause is being in
 * the wrong place rather than a broken project, and the path is what tells the
 * two apart.
 */
export function vendureProjectRequiredMessage(commandPath: string[], cwd: string = process.cwd()): string {
    return (
        `vendure ${commandPath.join(' ')} must be run from a Vendure project directory.\n` +
        `No package.json with a Vendure dependency was found in ${cwd} or any parent directory.\n`
    );
}
