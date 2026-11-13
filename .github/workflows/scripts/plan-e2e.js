// Prints the e2e jobs of each database as a matrix for the e2e jobs of build_and_test.yml.
//
// Core runs in shards (`vitest --shard=<index>/<count>`), because it has most of the e2e specs.
// The other packages with an e2e target run in one `plugins` job for each database.
// A database gets no jobs when no project with an e2e target is affected.
//
// Usage: node plan-e2e.js <affected | run-many>
// In CI, nx-set-shas sets the base and head that `--affected` uses.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const CORE = '@vendure/core';

/** The number of core shards for each database. The core e2e specs take longer on MySQL and Postgres. */
const CORE_SHARDS = {
    sqljs: 5,
    mariadb: 6,
    postgres: 7,
    mysql: 7,
};

/**
 * @param {string[]} projects The projects with an e2e target that CI must test.
 * @returns {Record<string, Array<{ id: string, shard?: string }>>} The jobs for each database.
 */
function planE2e(projects) {
    const hasCore = projects.includes(CORE);
    const hasPlugins = projects.some(project => project !== CORE);
    return Object.fromEntries(
        Object.entries(CORE_SHARDS).map(([db, count]) => {
            const jobs = [];
            if (hasPlugins) {
                jobs.push({ id: 'plugins' });
            }
            if (hasCore) {
                for (let index = 1; index <= count; index++) {
                    jobs.push({ id: `core-${index}`, shard: `${index}/${count}` });
                }
            }
            return [db, jobs];
        }),
    );
}

/**
 * @param {string} nxCommand
 * @returns {string[]}
 */
function listE2eProjects(nxCommand) {
    // Runs the Nx CLI with the current Node binary, so that the command does not depend on PATH.
    const args = [require.resolve('nx/bin/nx.js'), 'show', 'projects', '--withTarget', 'e2e', '--json'];
    if (nxCommand === 'affected') {
        args.push('--affected');
    } else if (nxCommand !== 'run-many') {
        throw new Error(`Unknown Nx command "${nxCommand}". Use "affected" or "run-many".`);
    }
    return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' }));
}

if (require.main === module) {
    const plan = planE2e(listE2eProjects(process.argv[2]));
    const lines = Object.entries(plan).map(([db, jobs]) => `e2e-${db}=${JSON.stringify(jobs)}`);
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
    }
    console.log(lines.join('\n'));
}

module.exports = { planE2e, CORE_SHARDS };
