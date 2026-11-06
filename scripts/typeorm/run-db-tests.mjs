#!/usr/bin/env node
/**
 * Runs the test suites that talk to a database, against whichever TypeORM
 * profile the workspace is currently set to.
 *
 * The suites themselves are the normal `test` and `e2e` scripts. This wrapper
 * exists so that a run is verified and labelled: it refuses to start against a
 * broken install, and it states the TypeORM version and database engine that
 * were actually exercised. Without that, a log full of failures gives no way to
 * tell a real incompatibility from a mis-resolved dependency.
 *
 * Usage:
 *   node scripts/typeorm/run-db-tests.mjs              # unit + e2e, sqljs
 *   DB=postgres node scripts/typeorm/run-db-tests.mjs  # unit + e2e, postgres
 *   node scripts/typeorm/run-db-tests.mjs --e2e-only
 *   node scripts/typeorm/run-db-tests.mjs --scope @vendure/core
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');

const args = process.argv.slice(2);
const e2eOnly = args.includes('--e2e-only');
const unitOnly = args.includes('--unit-only');
const scopeIndex = args.indexOf('--scope');
const scope = scopeIndex === -1 ? undefined : args[scopeIndex + 1];

if (e2eOnly && unitOnly) {
    console.error('--e2e-only and --unit-only select nothing when combined. Pass at most one.');
    process.exit(1);
}
if (scopeIndex !== -1 && !scope) {
    console.error('--scope needs a package name, e.g. --scope @vendure/core');
    process.exit(1);
}

const verify = spawnSync(process.execPath, [path.join(scriptDir, 'verify.mjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
});
if (verify.status !== 0) {
    process.exit(verify.status ?? 1);
}

const typeormVersion = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'node_modules', 'typeorm', 'package.json'), 'utf8'),
).version;
const dbEngine = process.env.DB || 'sqljs';

console.log(`\nRunning database tests against typeorm@${typeormVersion} on ${dbEngine}.\n`);

const scopeArgs = scope ? ['--scope', scope] : [];
const suites = [
    ...(e2eOnly ? [] : [{ name: 'unit', args: ['run', 'test', ...scopeArgs, '--stream', '--no-bail'] }]),
    ...(unitOnly ? [] : [{ name: 'e2e', args: ['run', 'e2e', ...scopeArgs, '--stream', '--no-bail'] }]),
];

// Run lerna's entry point under the current Node binary, so neither the
// executable nor the runtime is resolved through PATH.
const lernaCli = path.join(repoRoot, 'node_modules', 'lerna', 'dist', 'cli.js');
if (!fs.existsSync(lernaCli)) {
    console.error(`Could not find lerna at ${lernaCli}. Run \`bun install\` first.`);
    process.exit(1);
}

const failed = [];
for (const suite of suites) {
    const result = spawnSync(process.execPath, [lernaCli, ...suite.args], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, DB: dbEngine },
    });
    if (result.status !== 0) {
        failed.push(suite.name);
    }
}

console.log(
    `\ntypeorm@${typeormVersion} on ${dbEngine}: ${failed.length ? `${failed.join(', ')} failed` : 'all suites passed'}`,
);
process.exit(failed.length ? 1 : 0);
