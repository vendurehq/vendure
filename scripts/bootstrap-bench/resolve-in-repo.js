/**
 * Resolves a path supplied on the command line against the repository root and
 * rejects anything that escapes it.
 *
 * The bench scripts only ever read profiles written by `bench.js --cpu-prof`
 * (which writes to `profiles/` inside this directory) and write dumps that are
 * compared against each other, so confining them to the repository costs
 * nothing and means no argument is used as a path without being checked first.
 */
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * @param {string | undefined} input the raw command-line argument
 * @param {string} description used in the error message, e.g. 'profile path'
 * @returns {string} an absolute path guaranteed to be inside the repository
 */
function resolveInRepo(input, description) {
    if (!input) {
        console.error(`Missing ${description}.`);
        process.exit(1);
    }
    // Resolved against the working directory, so relative arguments behave the
    // way they do for any other CLI, then checked for containment below.
    const relative = path.relative(repoRoot, path.resolve(input));
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        console.error(`The ${description} must be inside the repository.`);
        process.exit(1);
    }
    // Rebuilt from the repository root plus the validated relative segment, so
    // the returned path cannot contain any unchecked part of the argument.
    return path.join(repoRoot, relative);
}

module.exports = { repoRoot, resolveInRepo };
