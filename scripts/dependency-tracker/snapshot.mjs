#!/usr/bin/env node
/**
 * Dependency snapshot tool for the Vendure dependency-audit effort.
 *
 * Walks `package-lock.json` (npm v3 format) and produces two outputs:
 *   1. A human-readable Markdown block (default, written to stdout).
 *   2. A JSON snapshot (`--json`) suitable for diffing between stages.
 *
 * Usage:
 *   node scripts/dependency-tracker/snapshot.mjs               # Markdown to stdout
 *   node scripts/dependency-tracker/snapshot.mjs --json        # JSON to stdout
 *   node scripts/dependency-tracker/snapshot.mjs --stage="Baseline"
 *   node scripts/dependency-tracker/snapshot.mjs --append      # Append MD to CHANGES.md
 *
 * Requires `package-lock.json` at repo root. If missing, run `npm install --package-lock-only`
 * first (this does not modify node_modules, just refreshes the lockfile).
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const lockfilePath = resolve(repoRoot, 'package-lock.json');
const changesMdPath = resolve(__dirname, 'CHANGES.md');

const args = parseArgs(process.argv.slice(2));

if (!existsSync(lockfilePath)) {
    console.error('ERROR: package-lock.json not found at repo root.');
    console.error('Run `npm install --package-lock-only` first to generate it.');
    process.exit(1);
}

const lock = JSON.parse(readFileSync(lockfilePath, 'utf8'));
const packages = lock.packages;

const VENDURE_PACKAGES = [
    'packages/core',
    'packages/common',
    'packages/email-plugin',
    'packages/asset-server-plugin',
    'packages/admin-ui-plugin',
    'packages/telemetry-plugin',
    'packages/harden-plugin',
    'packages/job-queue-plugin',
    'packages/graphiql-plugin',
    'packages/sentry-plugin',
    'packages/testing',
    'packages/cli',
    'packages/create',
    'packages/dashboard',
    'packages/ui-devkit',
    'packages/admin-ui',
];

// --- Lockfile walker -------------------------------------------------------

function resolveDep(fromLocation, depName) {
    let cur = fromLocation;
    while (true) {
        const candidate = cur ? `${cur}/node_modules/${depName}` : `node_modules/${depName}`;
        if (packages[candidate]) return candidate;
        if (!cur) return null;
        const idx = cur.lastIndexOf('/node_modules/');
        if (idx < 0) {
            cur = '';
            continue;
        }
        cur = cur.substring(0, idx);
    }
}

function transitiveSet(startLocation, includeDev = false) {
    const seen = new Set();
    const stack = [startLocation];
    while (stack.length) {
        const loc = stack.pop();
        if (seen.has(loc)) continue;
        seen.add(loc);
        const pkg = packages[loc];
        if (!pkg) continue;
        const deps = {
            ...(pkg.dependencies ?? {}),
            ...(pkg.peerDependencies ?? {}),
            ...(pkg.optionalDependencies ?? {}),
        };
        if (includeDev) Object.assign(deps, pkg.devDependencies ?? {});
        for (const depName of Object.keys(deps)) {
            const resolved = resolveDep(loc, depName);
            if (resolved && !seen.has(resolved)) stack.push(resolved);
        }
    }
    return seen;
}

function uniqueNames(locs) {
    return new Set([...locs].map(l => l.replace(/^.*node_modules\//, '')));
}

// --- Aggregation ----------------------------------------------------------

function analysePackage(pkgPath) {
    const root = packages[pkgPath];
    if (!root) return null;

    const directs = {
        ...(root.dependencies ?? {}),
        ...(root.peerDependencies ?? {}),
    };

    const rows = [];
    let union = new Set();
    for (const dep of Object.keys(directs)) {
        const resolved = resolveDep(pkgPath, dep) || resolveDep('', dep);
        if (!resolved) {
            rows.push({ dep, count: 0, missing: true });
            continue;
        }
        const locs = transitiveSet(resolved);
        const names = uniqueNames(locs);
        rows.push({ dep, count: names.size });
        union = new Set([...union, ...names]);
    }
    rows.sort((a, b) => b.count - a.count);

    return {
        package: pkgPath.replace('packages/', '@vendure/'),
        directCount: Object.keys(directs).length,
        transitiveTotal: union.size,
        directs: rows,
    };
}

function totalProdPackages() {
    const seen = new Set();
    for (const [key, pkg] of Object.entries(packages)) {
        if (!key.startsWith('node_modules/')) continue;
        if (pkg.dev) continue;
        seen.add(key.replace(/^.*node_modules\//, ''));
    }
    return seen.size;
}

function gitInfo() {
    try {
        const sha = execSync('git rev-parse --short HEAD', { cwd: repoRoot }).toString().trim();
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot })
            .toString()
            .trim();
        return { sha, branch };
    } catch {
        return { sha: 'unknown', branch: 'unknown' };
    }
}

// --- Output formatters ----------------------------------------------------

function formatMarkdown(snapshot, stageLabel) {
    const lines = [];
    lines.push(`## ${stageLabel}`);
    lines.push('');
    lines.push(`- **Commit:** \`${snapshot.git.sha}\` on \`${snapshot.git.branch}\``);
    lines.push(`- **Date:** ${snapshot.date}`);
    lines.push(`- **Total unique production packages:** ${snapshot.totalProdPackages}`);
    lines.push('');
    lines.push('### Per-Vendure-package transitive footprint');
    lines.push('');
    lines.push('| Package | Direct deps | Unique transitive (prod) |');
    lines.push('|---------|-------------|--------------------------|');
    for (const p of snapshot.perPackage) {
        if (!p) continue;
        lines.push(`| \`${p.package}\` | ${p.directCount} | ${p.transitiveTotal} |`);
    }
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Per-direct-dep transitive counts (click to expand)</summary>');
    lines.push('');
    for (const p of snapshot.perPackage) {
        if (!p || p.directs.length === 0) continue;
        lines.push(`#### \`${p.package}\``);
        lines.push('');
        lines.push('| Direct dep | Transitive count |');
        lines.push('|-----------|------------------|');
        for (const r of p.directs) {
            const label = r.missing ? `${r.dep} _(not in lockfile)_` : r.dep;
            lines.push(`| \`${label}\` | ${r.count} |`);
        }
        lines.push('');
    }
    lines.push('</details>');
    lines.push('');
    return lines.join('\n');
}

// --- Main -----------------------------------------------------------------

const snapshot = {
    date: new Date().toISOString(),
    git: gitInfo(),
    totalProdPackages: totalProdPackages(),
    perPackage: VENDURE_PACKAGES.map(analysePackage).filter(Boolean),
};

if (args.json) {
    process.stdout.write(JSON.stringify(snapshot, null, 2) + '\n');
} else {
    const stageLabel = args.stage ?? `Snapshot @ ${snapshot.git.sha}`;
    const md = formatMarkdown(snapshot, stageLabel);
    if (args.append) {
        appendFileSync(changesMdPath, '\n' + md);
        process.stderr.write(`Appended snapshot to ${changesMdPath}\n`);
    } else {
        process.stdout.write(md);
    }
}

// --- Args parser ----------------------------------------------------------

function parseArgs(argv) {
    const out = { json: false, append: false, stage: null };
    for (const a of argv) {
        if (a === '--json') out.json = true;
        else if (a === '--append') out.append = true;
        else if (a.startsWith('--stage=')) out.stage = a.slice('--stage='.length);
    }
    return out;
}
