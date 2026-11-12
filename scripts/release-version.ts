/* eslint-disable no-console */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { releaseVersion } from 'nx/release';

/**
 * Sets one new version on all packages in `packages/*` and prepares the release commit.
 *
 * 1. `nx release version` writes the new version to each package.json. Internal dependencies
 *    get the exact new version. The release group is fixed (see `release` in nx.json).
 * 2. The release checks run against the new version (see `releaseSteps` below).
 * 3. The script stages the files that the checks changed (see `stageSteps` below), commits the
 *    staged changes and adds an annotated tag `v<version>`. `--skip-git` stops after step 2.
 *
 * Usage:
 *   ts-node scripts/release-version.ts [specifier] [--preid <id>] [--message <msg>] [--skip-git] [--dry-run]
 *
 * `specifier` is a semver version or a bump keyword (patch, minor, prerelease, ...). Without it,
 * Nx asks for the version. `{version}` in `--message` is replaced with the new version.
 */

/**
 * The checks that ran in the root npm `version` lifecycle script when Lerna did the versioning.
 * `nx release` does not run npm lifecycle scripts, so they run here, after the new version is on disk.
 */
const releaseSteps = [
    'bun install',
    'bun run check-imports',
    'bun run --cwd packages/common generate-platform-promotion-snapshot',
    'bun run build',
    'bun run check-core-type-defs',
    'bun run generate-changelog',
];

/**
 * The `git add` steps of the old `version` lifecycle script. They run only when the script commits.
 */
const stageSteps = [
    'git add CHANGELOG*',
    'git add */version.ts',
    'git add bun.lock',
    'git add packages/common/src/platform-promotion-snapshot.ts',
];

const repoRoot = path.join(__dirname, '..');

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            preid: { type: 'string' },
            message: { type: 'string', default: 'chore: Publish v{version}' },
            'skip-git': { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
        },
    });
    const dryRun = values['dry-run'];
    const skipGit = values['skip-git'];

    const { workspaceVersion } = await releaseVersion({
        specifier: positionals[0],
        preid: values.preid,
        dryRun,
        gitCommit: false,
        gitTag: false,
        stageChanges: !skipGit && !dryRun,
        verbose: false,
    });
    if (!workspaceVersion) {
        throw new Error('nx release version did not resolve a new version');
    }

    const message = values.message.replace(/\{version\}/g, workspaceVersion);
    const tag = `v${workspaceVersion}`;

    for (const step of [...releaseSteps, ...(skipGit ? [] : stageSteps)]) {
        console.log(dryRun ? `[dry-run] ${step}` : `\n$ ${step}`);
        if (!dryRun) {
            execSync(step, { cwd: repoRoot, stdio: 'inherit' });
        }
    }
    if (skipGit) {
        return;
    }
    // git reads the message from stdin, so the shell does not parse it.
    console.log(dryRun ? `[dry-run] git commit -F - <<< "${message}"` : `\n$ git commit -F -`);
    if (!dryRun) {
        execSync('git commit -F -', { cwd: repoRoot, input: message, stdio: ['pipe', 'inherit', 'inherit'] });
    }
    const tagStep = `git tag -a ${tag} -m ${tag}`;
    console.log(dryRun ? `[dry-run] ${tagStep}` : `\n$ ${tagStep}`);
    if (!dryRun) {
        execSync(tagStep, { cwd: repoRoot, stdio: 'inherit' });
    }
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
