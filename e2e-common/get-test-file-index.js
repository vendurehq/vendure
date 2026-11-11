const fs = require('node:fs');
const path = require('node:path');

/** The files that call `testConfig()`: the e2e specs and the benchmarks. */
const TEST_FILE = /\.(e2e-spec|bench)\.ts$/;

/**
 * Returns the position of a test file in the sorted list of all test files (`*.e2e-spec.ts` and
 * `*.bench.ts`) of its package.
 * The e2e tests add this index to the base port of the package.
 *
 * The index depends only on the test files in the checkout. Other entries, such as the `__data__`
 * folder that the first test run creates, and the folder of the test file do not change it.
 * Thus two test files of one package never get the same port, in each run order and in each shard.
 *
 * @param {string} packageRoot The package folder, for example `packages/core`.
 * @param {string} testFile The absolute path of the test file.
 * @return {number} The index, or -1 when the file is not a test file of the package.
 */
function getTestFileIndex(packageRoot, testFile) {
    const relativePath = path.relative(packageRoot, testFile).split(path.sep).join('/');
    return listTestFiles(packageRoot).indexOf(relativePath);
}

/**
 * @param {string} packageRoot
 * @return {string[]} The paths relative to `packageRoot`, with `/` as separator, sorted.
 */
function listTestFiles(packageRoot) {
    /** @type {string[]} */
    const files = [];
    /** @param {string} relativeDir */
    const walk = relativeDir => {
        for (const entry of fs.readdirSync(path.join(packageRoot, relativeDir), { withFileTypes: true })) {
            const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                    walk(relativePath);
                }
            } else if (TEST_FILE.test(entry.name)) {
                files.push(relativePath);
            }
        }
    };
    walk('');
    return files.sort((a, b) => a.localeCompare(b));
}

module.exports = { getTestFileIndex, listTestFiles };
