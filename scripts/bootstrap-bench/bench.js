/**
 * Bootstrap benchmark orchestrator.
 *
 * Usage:
 *   node scripts/bootstrap-bench/bench.js [server|worker|phases] [--runs=7] [--cpu-prof]
 *
 * Spawns a fresh node process per run and aggregates the timing JSON each entry
 * script prints. With --cpu-prof, writes .cpuprofile files to ./profiles/.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const target = args.find(a => !a.startsWith('--')) || 'server';
const runs = Number((args.find(a => a.startsWith('--runs=')) || '').split('=')[1] || 7);
const cpuProf = args.includes('--cpu-prof');

const heavy = target.endsWith('-heavy');
const baseTarget = heavy ? target.slice(0, -'-heavy'.length) : target;
const entry = path.join(__dirname, `${baseTarget}-entry.js`);
if (!fs.existsSync(entry)) {
    console.error(`Unknown target "${target}"`);
    process.exit(1);
}
const dbFile = heavy ? 'bench-heavy.sqlite' : 'bench.sqlite';
if (!fs.existsSync(path.join(__dirname, dbFile))) {
    console.error(
        `${dbFile} missing — run: node scripts/bootstrap-bench/${heavy ? 'setup-heavy-db.js' : 'populate-db.js'}`,
    );
    process.exit(1);
}
if (heavy) process.env.BENCH_HEAVY = '1';

const profDir = path.join(__dirname, 'profiles');
const nodeArgs = [];
if (cpuProf) {
    fs.mkdirSync(profDir, { recursive: true });
    nodeArgs.push('--cpu-prof', `--cpu-prof-dir=${profDir}`, `--cpu-prof-name=${target}-${Date.now()}.cpuprofile`);
}

const results = [];
for (let i = 0; i < runs; i++) {
    const res = spawnSync('node', [...nodeArgs, entry], {
        encoding: 'utf-8',
        env: { ...process.env },
        timeout: 120_000,
    });
    const lines = (res.stdout || '').trim().split('\n');
    const jsonLine = lines.reverse().find(l => l.startsWith('{'));
    if (!jsonLine) {
        console.error(`Run ${i + 1} failed:\n${res.stdout}\n${res.stderr}`);
        process.exit(1);
    }
    const data = JSON.parse(jsonLine);
    results.push(data);
    process.stderr.write(`run ${i + 1}/${runs}: total=${data.totalMs.toFixed(0)}ms\n`);
}

function stats(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { min: sorted[0], median, mean, max: sorted[sorted.length - 1] };
}

const keys = Object.keys(results[0]).filter(k => k !== 'target');
const summary = {};
for (const key of keys) {
    summary[key] = stats(results.map(r => r[key]));
}

console.log(`\n=== ${target} bootstrap benchmark (${runs} runs) ===`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('phase', 22) + pad('min', 10) + pad('median', 10) + pad('mean', 10) + 'max');
for (const [key, s] of Object.entries(summary)) {
    console.log(
        pad(key, 22) +
            pad(s.min.toFixed(1), 10) +
            pad(s.median.toFixed(1), 10) +
            pad(s.mean.toFixed(1), 10) +
            s.max.toFixed(1),
    );
}
console.log(JSON.stringify({ target, runs, summary }));
