#!/usr/bin/env node
/**
 * Runs the same builds as `lerna run ci`, but without stopping at type errors, so
 * that the database-backed suites can run and report what breaks at runtime.
 *
 * Packages are selected by the presence of a `ci` script, as `lerna run ci` selects
 * them. Any package without one is named in the output, since some of those have
 * e2e suites and an unbuilt package fails in ways that read like a version
 * incompatibility.
 *
 * See scripts/typeorm/README.md for why the build stages are run separately.
 *
 * Usage:
 *   node scripts/typeorm/build-for-tests.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const order = topologicalPackageOrder();
const failed = [];

// Searched in the order a package manager would, to resolve each command to an
// absolute path instead of relying on PATH at spawn time.
const binDirs = [
    path.join(repoRoot, 'node_modules', '.bin'),
    ...order.map(pkg => path.join(pkg.location, 'node_modules', '.bin')),
];

const notBuilt = [];

for (const { name, location } of order) {
    const manifest = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
    const stages = resolveBuildStages(manifest);
    if (stages.length === 0) {
        notBuilt.push({ name, hasE2e: Boolean(manifest.scripts?.e2e) });
        continue;
    }
    console.log(`\n--- ${name}`);
    for (const stage of stages) {
        console.log(`$ ${stage}`);
        const [command, ...commandArgs] = stage.split(/\s+/);
        const executable = resolveLocalBin(command);
        if (!executable) {
            console.log(`  skipped: no local binary named "${command}"`);
            failed.push(`${name}: ${stage}`);
            continue;
        }
        const result = spawnSync(executable, commandArgs, { cwd: location, stdio: 'inherit' });
        if (result.status !== 0) {
            failed.push(`${name}: ${stage}`);
        }
    }
}

if (failed.length) {
    console.log(`\n${failed.length} build stage(s) reported errors; output was still emitted:`);
    for (const entry of failed) {
        console.log(`  ${entry}`);
    }
} else {
    console.log('\nAll build stages passed.');
}

const skippedWithE2e = notBuilt.filter(pkg => pkg.hasE2e);
if (skippedWithE2e.length) {
    console.log(
        `\nNot built (no \`ci\` script), but has an e2e suite that \`lerna run e2e\` will run: ` +
            `${skippedWithE2e.map(pkg => pkg.name).join(', ')}. ` +
            'A failure in those suites may be a missing build rather than a TypeORM incompatibility.',
    );
}

// Always succeeds: reporting build failures is the job of the `build` job, and
// exiting non-zero here would stop the tests this script exists to enable.
process.exit(0);

/**
 * Returns the `ci` script's stages, split on `&&` so each runs regardless of
 * whether the previous one exited non-zero. One level of `npm run <script>`
 * indirection is followed, which covers the `ci` -> `build` alias the packages
 * use. Splitting on `&&` assumes no build command contains `&&` inside a quoted
 * argument, which holds for every package script in this repo.
 */
function resolveBuildStages(manifest) {
    const scripts = manifest.scripts ?? {};
    let script = scripts.ci;
    if (!script) {
        return [];
    }
    const alias = /^(?:npm|bun|yarn) run ([\w:-]+)$/.exec(script.trim());
    if (alias && scripts[alias[1]]) {
        script = scripts[alias[1]];
    }
    return script
        .split('&&')
        .map(stage => stage.trim())
        .filter(Boolean);
}

/**
 * Finds `command` in the workspace's `.bin` directories and returns its absolute
 * path, or undefined if it is not installed.
 */
function resolveLocalBin(command) {
    const candidates =
        process.platform === 'win32' ? [`${command}.cmd`, `${command}.exe`, command] : [command];
    for (const dir of binDirs) {
        for (const candidate of candidates) {
            const full = path.join(dir, candidate);
            if (fs.existsSync(full)) {
                return full;
            }
        }
    }
    return undefined;
}

/**
 * Orders the workspace packages so that each one is built after the packages it
 * depends on. Read from the manifests so that the order is still available when the
 * workspace is half-installed.
 */
function topologicalPackageOrder() {
    const packagesDir = path.join(repoRoot, 'packages');
    const packages = fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(packagesDir, entry.name))
        .filter(location => fs.existsSync(path.join(location, 'package.json')))
        .map(location => {
            const manifest = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
            return {
                name: manifest.name,
                location,
                deps: Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
            };
        });

    const byName = new Map(packages.map(pkg => [pkg.name, pkg]));
    const ordered = [];
    const visiting = new Set();
    const visited = new Set();

    const visit = pkg => {
        if (visited.has(pkg.name) || visiting.has(pkg.name)) {
            // A cycle between workspace packages is not something this script can
            // resolve, so the package is emitted where it was first reached.
            return;
        }
        visiting.add(pkg.name);
        for (const dep of pkg.deps) {
            const depPkg = byName.get(dep);
            if (depPkg) {
                visit(depPkg);
            }
        }
        visiting.delete(pkg.name);
        visited.add(pkg.name);
        ordered.push({ name: pkg.name, location: pkg.location });
    };

    for (const pkg of packages) {
        visit(pkg);
    }
    return ordered;
}
