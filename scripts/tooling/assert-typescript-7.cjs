/**
 * Fails the build loudly unless `tsc` is TypeScript 7.
 *
 * Package build scripts call `tsc`, which resolves through node_modules/.bin. If another package
 * that ships a `tsc` bin (such as a typescript@6 copy) were ever linked there instead, the build
 * would silently compile with the wrong TypeScript version. Run from a package script, so that
 * PATH is the same as the build's.
 */
const { execFileSync } = require('node:child_process');

const MIN_MAJOR = 7;

function fail(message) {
    // eslint-disable-next-line no-console
    console.error(`\n[assert-typescript-7] ${message}\n`);
    process.exit(1);
}

let tscVersionOutput;
try {
    tscVersionOutput = execFileSync('tsc', ['--version'], {
        encoding: 'utf-8',
        shell: process.platform === 'win32',
    }).trim();
} catch (e) {
    fail(`Could not run "tsc --version": ${e instanceof Error ? e.message : String(e)}`);
}

const match = /Version (\d+)\.\S+/.exec(tscVersionOutput);
if (!match) {
    fail(`Could not read the TypeScript version from "tsc --version": ${tscVersionOutput}`);
}
if (Number(match[1]) < MIN_MAJOR) {
    fail(
        `"tsc" is ${match[0]}, but the build requires TypeScript ${MIN_MAJOR}. ` +
            'Check which package node_modules/.bin/tsc links to (e.g. `readlink -f node_modules/.bin/tsc`).',
    );
}
// eslint-disable-next-line no-console
console.log(`[assert-typescript-7] Building with TypeScript ${match[0].replace('Version ', '')}`);
