/**
 * Boots a real Vendure worker via bootstrapWorker() and prints timing JSON to stdout.
 */
const startupMs = performance.now();
const core = require('@vendure/core');
const requireCoreMs = performance.now() - startupMs;
const { getBenchConfig } = require('./bench-config');

async function main() {
    const config = getBenchConfig(core);
    const t0 = performance.now();
    const worker = await core.bootstrapWorker(config);
    const bootstrapMs = performance.now() - t0;
    const totalMs = performance.now();
    console.log(
        JSON.stringify({ target: 'worker', startupMs, requireCoreMs, bootstrapMs, totalMs }),
    );
    await Promise.race([worker.app.close(), new Promise(resolve => setTimeout(resolve, 3000))]);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
