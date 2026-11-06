/**
 * Fails the build loudly unless `tsc` is TypeScript 7.
 *
 * Package build scripts call `tsc`, which the package manager resolves to the first
 * node_modules/.bin/tsc in the package's directory or one of its parents. If another package
 * that ships a `tsc` bin (such as a typescript@6 copy) were ever linked there instead, the build
 * would silently compile with the wrong TypeScript version.
 *
 * This does the same lookup, starting from the working directory of the build script, and reads
 * the version from the package.json of the package that the bin link points to. It does not run
 * `tsc` or search PATH.
 */
const { existsSync, readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');

const MIN_MAJOR = 7;
const BIN_NAME = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';

function fail(message) {
    // eslint-disable-next-line no-console
    console.error(`\n[assert-typescript-7] ${message}\n`);
    process.exit(1);
}

/** Returns the first node_modules/.bin/tsc in `startDir` or its parents. */
function findTscBin(startDir) {
    let dir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(dir, 'node_modules', '.bin', BIN_NAME);
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/** Returns the package.json of the package that contains `file`. */
function findOwningPackageJson(file) {
    let dir = path.dirname(file);
    while (true) {
        const candidate = path.join(dir, 'package.json');
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

const binPath = findTscBin(process.cwd());
if (!binPath) {
    fail(`No node_modules/.bin/${BIN_NAME} found in ${process.cwd()} or its parents. Run "bun install".`);
}

let packageJsonPath;
if (process.platform === 'win32') {
    // On Windows, .bin/tsc.cmd is a shim rather than a symlink. The package manager creates it
    // for the hoisted `typescript` package, so read that package's version.
    packageJsonPath = path.join(path.dirname(path.dirname(binPath)), 'typescript', 'package.json');
} else {
    packageJsonPath = findOwningPackageJson(realpathSync(binPath));
}
if (!packageJsonPath || !existsSync(packageJsonPath)) {
    fail(`Could not find the package that ${binPath} belongs to.`);
}

const { name, version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const major = Number(String(version).split('.')[0]);
if (!(major >= MIN_MAJOR)) {
    fail(
        `"tsc" (${binPath}) is ${String(name)} ${String(version)} from ${packageJsonPath}, but the build ` +
            `requires TypeScript ${MIN_MAJOR}. Check which package node_modules/.bin/tsc links to.`,
    );
}
// eslint-disable-next-line no-console
console.log(`[assert-typescript-7] Building with TypeScript ${String(version)}`);
