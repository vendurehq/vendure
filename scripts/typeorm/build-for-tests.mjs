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

// A package manager puts the local `.bin` directories on PATH before running a
// script; spawning the commands directly does not, so it is done here.
const binPath = [
    path.join(repoRoot, 'node_modules', '.bin'),
    ...order.map(pkg => path.join(pkg.location, 'node_modules', '.bin')),
].join(path.delimiter);
const env = { ...process.env, PATH: `${binPath}${path.delimiter}${process.env.PATH ?? ''}` };

for (const { name, location } of order) {
    const manifest = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
    const stages = resolveBuildStages(manifest);
    if (stages.length === 0) {
        continue;
    }
    console.log(`\n--- ${name}`);
    for (const stage of stages) {
        console.log(`$ ${stage}`);
        const result = spawnSync(stage, { cwd: location, stdio: 'inherit', shell: true, env });
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

function topologicalPackageOrder() {
    const result = spawnSync('bunx', ['lerna', 'list', '--toposort', '--json', '--all'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        console.error(result.stderr);
        throw new Error('Could not determine the package build order via lerna.');
    }
    // lerna prints progress on stdout before the JSON payload.
    const json = result.stdout.slice(result.stdout.indexOf('['));
    return JSON.parse(json);
}
