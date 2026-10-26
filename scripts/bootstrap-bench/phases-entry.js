/**
 * Mirrors the steps of core's bootstrap() with a timer around each phase, to
 * attribute where the time goes. Kept in sync with packages/core/src/bootstrap.ts —
 * if the totals here drift from server-entry.js, this file is stale.
 */
const startupMs = performance.now();
const core = require('@vendure/core');
const requireCoreMs = performance.now() - startupMs;
const { getBenchConfig } = require('./bench-config');

const phases = { startupMs, requireCoreMs };
let last = performance.now();
function mark(name) {
    const now = performance.now();
    phases[name] = now - last;
    last = now;
}

async function main() {
    const userConfig = getBenchConfig(core);

    const config = await core.preBootstrapConfig(userConfig);
    mark('preBootstrapConfig');

    core.Logger.useLogger(config.logger);
    const appModule = require('@vendure/core/dist/app.module.js');
    mark('requireAppModule');

    const { NestFactory } = require('@nestjs/core');
    const { hostname, port, cors } = config.apiOptions;
    core.DefaultLogger.hideNestBoostrapLogs();
    const app = await NestFactory.create(appModule.AppModule, {
        cors,
        logger: new core.Logger(),
    });
    mark('nestFactoryCreate');

    core.DefaultLogger.restoreOriginalLogLevel();
    app.useLogger(new core.Logger());
    await app.init();
    mark('appInitHooks');
    await app.listen(port, hostname || '');
    mark('appListen');

    phases.totalMs = performance.now();
    console.log(JSON.stringify({ target: 'phases', ...phases }));
    await Promise.race([app.close(), new Promise(resolve => setTimeout(resolve, 3000))]);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
