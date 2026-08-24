/**
 * Shared config for the bootstrap benchmark. Uses only plugins that ship inside
 * @vendure/core so that only core + common need to be built.
 */
const path = require('path');

function getBenchConfig(core, { synchronize = false, logLevel } = {}) {
    const {
        DefaultJobQueuePlugin,
        DefaultSchedulerPlugin,
        DefaultSearchPlugin,
        DefaultLogger,
        LogLevel,
        dummyPaymentHandler,
    } = core;
    const heavy = process.env.BENCH_HEAVY === '1';
    const heavyPlugins = heavy
        ? require('./heavy-plugins').createHeavyPlugins(core, Number(process.env.BENCH_HEAVY_COUNT) || 20)
        : [];
    return {
        apiOptions: {
            port: Number(process.env.BENCH_PORT) || 4999,
        },
        authOptions: {
            tokenMethod: 'bearer',
        },
        dbConnectionOptions: {
            type: 'better-sqlite3',
            synchronize,
            database: path.join(__dirname, heavy ? 'bench-heavy.sqlite' : 'bench.sqlite'),
        },
        paymentOptions: {
            paymentMethodHandlers: [dummyPaymentHandler],
        },
        logger: new DefaultLogger({ level: logLevel ?? LogLevel.Error }),
        plugins: [
            DefaultJobQueuePlugin.init({}),
            DefaultSchedulerPlugin.init({}),
            DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: false }),
            ...heavyPlugins,
        ],
    };
}

module.exports = { getBenchConfig };
