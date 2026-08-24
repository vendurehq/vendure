/**
 * Boots a real Vendure server via bootstrap() and prints timing JSON to stdout.
 * performance.now() is ms since process start (timeOrigin), so `startup` captures
 * node init + this file's own require cost.
 */
const startupMs = performance.now();
const core = require('@vendure/core');
const requireCoreMs = performance.now() - startupMs;
const { getBenchConfig } = require('./bench-config');

async function main() {
    const config = getBenchConfig(core);
    const t0 = performance.now();
    const app = await core.bootstrap(config);
    const bootstrapMs = performance.now() - t0;
    const totalMs = performance.now();
    console.log(
        JSON.stringify({ target: 'server', startupMs, requireCoreMs, bootstrapMs, totalMs }),
    );
    await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 3000))]);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
