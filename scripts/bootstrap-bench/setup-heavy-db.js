/**
 * One-time setup for the heavy benchmark DB: copies bench.sqlite and boots once
 * with synchronize:true so the synthetic plugin tables + custom field columns
 * get created. Run after populate-db.js.
 */
const fs = require('fs');
const path = require('path');

const base = path.join(__dirname, 'bench.sqlite');
const heavyDb = path.join(__dirname, 'bench-heavy.sqlite');
if (!fs.existsSync(base)) {
    console.error('bench.sqlite missing — run populate-db.js first.');
    process.exit(1);
}
if (fs.existsSync(heavyDb)) {
    console.log('bench-heavy.sqlite already exists — delete it to re-create.');
    process.exit(0);
}
fs.copyFileSync(base, heavyDb);

process.env.BENCH_HEAVY = '1';
const core = require('@vendure/core');
const { getBenchConfig } = require('./bench-config');

core.bootstrap(getBenchConfig(core, { synchronize: true, logLevel: core.LogLevel.Info }))
    .then(async app => {
        await app.close();
        console.log('bench-heavy.sqlite ready.');
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
