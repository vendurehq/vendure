#!/usr/bin/env node
/**
 * Asserts that the installed TypeORM matches the profile the workspace is set
 * to, and that exactly one copy of it is installed.
 *
 * See scripts/typeorm/README.md for why a split install is worth ruling out
 * before a test run.
 *
 * Usage:
 *   node scripts/typeorm/verify.mjs            # check against the profile in package.json
 *   node scripts/typeorm/verify.mjs --expect 1 # check against an explicit profile
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const PROFILE_FIELD = 'typeormProfile';

const args = process.argv.slice(2);
const expectFlagIndex = args.indexOf('--expect');
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const expected = expectFlagIndex === -1 ? rootPackageJson[PROFILE_FIELD] : args[expectFlagIndex + 1];

const installs = findTypeormInstalls();

if (installs.length === 0) {
    console.error('No installed copy of typeorm found. Run `bun install` first.');
    process.exit(1);
}

for (const { version, location } of installs) {
    console.log(`typeorm@${version}  ${location}`);
}

const distinctVersions = [...new Set(installs.map(i => i.version))];
if (distinctVersions.length > 1) {
    console.error(
        `\nFound ${distinctVersions.length} different typeorm versions installed (${distinctVersions.join(
            ', ',
        )}). Entity metadata is registered against a single typeorm instance, so a split install ` +
            'produces failures unrelated to version compatibility. Delete node_modules and reinstall.',
    );
    process.exit(1);
}

const [actual] = distinctVersions;

if (!expected) {
    console.log(`\nNo TypeORM profile is set; using typeorm@${actual}.`);
    process.exit(0);
}

// Compared against the version the profile pins, not its name: "0.3" is a label,
// and matching on it loosely would accept any 0.x.y.
const { profiles } = JSON.parse(fs.readFileSync(path.join(scriptDir, 'profiles.json'), 'utf8'));
const pinned = profiles[expected]?.typeorm;
if (!pinned) {
    console.error(`\nUnknown TypeORM profile "${expected}". Check package.json and profiles.json.`);
    process.exit(1);
}
if (pinned !== actual) {
    console.error(
        `\nProfile "${expected}" pins typeorm@${pinned} but typeorm@${actual} is installed. ` +
            `Run \`node scripts/typeorm/use-version.mjs ${expected}\` to reinstall.`,
    );
    process.exit(1);
}

console.log(`\nTypeORM profile "${expected}" verified: typeorm@${actual}.`);

/**
 * Looks for typeorm in the root, in each workspace package, and one level of
 * nesting under the root `node_modules` — the places bun can put a second copy.
 */
function findTypeormInstalls() {
    const candidateRoots = [
        path.join(repoRoot, 'node_modules'),
        ...listDirs(path.join(repoRoot, 'packages')).map(dir => path.join(dir, 'node_modules')),
        ...listDirs(path.join(repoRoot, 'node_modules')).flatMap(dir =>
            path.basename(dir).startsWith('@')
                ? listDirs(dir).map(scoped => path.join(scoped, 'node_modules'))
                : [path.join(dir, 'node_modules')],
        ),
    ];

    const found = [];
    for (const modulesDir of candidateRoots) {
        const manifest = path.join(modulesDir, 'typeorm', 'package.json');
        if (fs.existsSync(manifest)) {
            found.push({
                version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version,
                location: path.relative(repoRoot, path.dirname(manifest)),
            });
        }
    }
    return found;
}

function listDirs(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name !== 'typeorm')
        .map(entry => path.join(dir, entry.name));
}
