#!/usr/bin/env node
/**
 * Switches the whole workspace onto one of the TypeORM profiles defined in
 * `profiles.json`, so the database-backed test suites can be run against each
 * supported TypeORM major.
 *
 * `typeorm` is a direct dependency of `@vendure/core` rather than a peer
 * dependency, so the version cannot be selected per-install. The profile is
 * applied as a set of root-level `overrides`, which bun honours for workspace
 * packages' direct dependencies.
 *
 * Usage:
 *   node scripts/typeorm/use-version.mjs 1          # switch to TypeORM v1 and install
 *   node scripts/typeorm/use-version.mjs 0.3        # switch back to TypeORM v0.3 and install
 *   node scripts/typeorm/use-version.mjs --reset    # drop the profile and restore the default install
 *   node scripts/typeorm/use-version.mjs 1 --no-install
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const rootPackageJsonPath = path.join(repoRoot, 'package.json');
const lockfilePath = path.join(repoRoot, 'bun.lock');
// Gitignored alongside the lockfile it copies; see .gitignore.
const lockfileBackupPath = path.join(repoRoot, 'bun.lock.typeorm-profile-backup');
const PROFILE_FIELD = 'typeormProfile';

const args = process.argv.slice(2);
const install = !args.includes('--no-install');
const reset = args.includes('--reset');
const requested = args.find(arg => !arg.startsWith('--'));

const { profiles } = JSON.parse(fs.readFileSync(path.join(scriptDir, 'profiles.json'), 'utf8'));

if (!reset && !requested) {
    console.error(
        `Specify a profile (${Object.keys(profiles).join(', ')}) or --reset.\n` +
            'See scripts/typeorm/README.md for details.',
    );
    process.exit(1);
}
if (requested && !profiles[requested]) {
    console.error(
        `Unknown TypeORM profile "${requested}". Available profiles: ${Object.keys(profiles).join(', ')}.`,
    );
    process.exit(1);
}

const rootPackageJsonSource = fs.readFileSync(rootPackageJsonPath, 'utf8');
const rootPackageJson = JSON.parse(rootPackageJsonSource);
const indent = /\n(\s+)"/.exec(rootPackageJsonSource)?.[1] ?? '  ';
const overrides = { ...(rootPackageJson.overrides ?? {}) };

// Every package named by any profile is removed first, so switching between
// profiles never leaves a stale override behind.
for (const profile of Object.values(profiles)) {
    for (const name of Object.keys(profile)) {
        delete overrides[name];
    }
}

if (reset) {
    delete rootPackageJson[PROFILE_FIELD];
    console.log('Removed the TypeORM profile; the workspace will install its default versions.');
} else {
    Object.assign(overrides, profiles[requested]);
    rootPackageJson[PROFILE_FIELD] = requested;
    console.log(`Applying TypeORM profile "${requested}":`);
    for (const [name, version] of Object.entries(profiles[requested])) {
        console.log(`  ${name}@${version}`);
    }
}

rootPackageJson.overrides = overrides;
fs.writeFileSync(rootPackageJsonPath, `${JSON.stringify(rootPackageJson, null, indent)}\n`);

if (!install) {
    console.log('\nSkipped install (--no-install). Run `bun install` to apply.');
    process.exit(0);
}

let frozen = false;
if (reset) {
    // A plain reset install floats every dependency to the newest version its
    // declared range allows, which is not the state the profile was applied on
    // top of. The lockfile saved when the profile was applied is put back so the
    // workspace returns to exactly the versions it had.
    if (fs.existsSync(lockfileBackupPath)) {
        fs.copyFileSync(lockfileBackupPath, lockfilePath);
        fs.rmSync(lockfileBackupPath);
        frozen = true;
        console.log('\nRestored the lockfile saved when the profile was applied.');
    } else {
        console.log(
            '\nNo saved lockfile found, so dependencies will resolve afresh within their ' +
                'declared ranges. Check bun.lock before committing.',
        );
    }
} else if (!fs.existsSync(lockfileBackupPath) && fs.existsSync(lockfilePath)) {
    fs.copyFileSync(lockfilePath, lockfileBackupPath);
}

console.log('\nInstalling…');
// Resolved through PATH by necessity: bun is the workspace's package manager and
// is not installed into the workspace itself. NOSONAR
execFileSync('bun', frozen ? ['install', '--frozen-lockfile'] : ['install'], {
    cwd: repoRoot,
    stdio: 'inherit',
});

if (reset) {
    console.log('\nThe workspace is back on its committed dependency versions.');
} else {
    console.log(
        '\npackage.json and bun.lock now hold profile-specific versions. ' +
            'Run `node scripts/typeorm/use-version.mjs --reset` before committing.',
    );
}
