/**
 * One-time setup: creates and populates bench.sqlite with the standard mock data.
 * Run: node scripts/bootstrap-bench/populate-db.js
 */
const fs = require('node:fs');
const path = require('node:path');

const dbFile = path.join(__dirname, 'bench.sqlite');
if (fs.existsSync(dbFile)) {
    console.log('bench.sqlite already exists — delete it to re-populate.');
    process.exit(0);
}

require('ts-node').register({
    transpileOnly: true,
    skipProject: true,
    compilerOptions: { module: 'commonjs', target: 'es2021', esModuleInterop: true },
});

const core = require('@vendure/core');
const { populate } = require('@vendure/core/cli');
const { getBenchConfig } = require('./bench-config');
const { initialData } = require('../../packages/core/mock-data/data-sources/initial-data.ts');

const config = getBenchConfig(core, { synchronize: true, logLevel: core.LogLevel.Info });

populate(
    () =>
        core.bootstrap(config).then(async app => {
            await app.get(core.JobQueueService).start();
            return app;
        }),
    initialData,
    path.join(__dirname, '../../packages/core/mock-data/data-sources/products.csv'),
)
    .then(async app => {
        // Give the search index jobs a moment to settle before closing.
        await new Promise(resolve => setTimeout(resolve, 5000));
        await app.close();
        console.log('bench.sqlite populated.');
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
