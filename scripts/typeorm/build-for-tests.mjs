#!/usr/bin/env node
/**
 * Builds the workspace as far as it will go, without stopping at type errors,
 * so that the database-backed suites can run and report what breaks at runtime.
 *
 * This exists because of how the build scripts are chained. `@vendure/core`'s
 * build runs three stages joined by `&&`: the main compile, the CLI compile,
 * and a copy of the static `.graphql` schema files. `tsc` still emits output
 * when it reports type errors, but its non-zero exit stops the chain, so a
 * single type error leaves `dist/` without the schema files. The server then
 * fails to boot with "No type definitions were found", which says nothing about
 * the actual incompatibility.
 *
 * Type errors are not swallowed by doing this — the `build` job in the same
 * workflow reports them. This script gives the second, independent signal:
 * which calls fail once the code is actually running.
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

// The local `.bin` directories, searched in the order a package manager would.
// Commands are resolved against these to an absolute path rather than being
// looked up through PATH at spawn time.
const binDirs = [
    path.join(repoRoot, 'node_modules', '.bin'),
    ...order.map(pkg => path.join(pkg.location, 'node_modules', '.bin')),
];

for (const { name, location } of order) {
    const manifest = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
    const stages = resolveBuildStages(manifest);
    if (stages.length === 0) {
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
 * depends on. Derived from the manifests directly rather than by shelling out to
 * lerna, which keeps the build order available even when the workspace is in a
 * half-installed state.
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
