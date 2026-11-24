/* eslint-disable no-console */
import { bootstrap, ConfigService, DefaultLogger, JobQueueService, LogLevel } from '@vendure/core';
import { populate } from '@vendure/core/cli';
import path from 'path';

import { config } from './src/vendure-config';

/**
 * Seeds the sample data of the Vendure repository's e2e tests. MOCK_DATA_DIR is
 * `packages/core/mock-data` in the repository checkout, and `initial-data.json` is its
 * `data-sources/initial-data.ts` as JSON.
 */
const mockDataDir = process.env.MOCK_DATA_DIR;
if (!mockDataDir) {
    throw new Error('Set MOCK_DATA_DIR to packages/core/mock-data in the Vendure repository');
}

populate(
    async () => {
        const app = await bootstrap({
            ...config,
            dbConnectionOptions: { ...config.dbConnectionOptions, synchronize: true },
            logger: new DefaultLogger({ level: LogLevel.Warn }),
            importExportOptions: { importAssetsDir: path.join(mockDataDir, 'assets') },
        });
        await app.get(JobQueueService).start();
        return app;
    },
    path.join(__dirname, 'initial-data.json'),
    path.join(mockDataDir, 'data-sources/products.csv'),
)
    .then(app => awaitSettledJobs(app).then(() => app.close()))
    .then(() => process.exit(0))
    .catch(err => {
        console.log(err);
        process.exit(1);
    });

/**
 * The import queues search-index jobs. They must all finish here: the server and the worker share
 * the SQLite file, and a worker still rebuilding the index when the smoke tests run holds the
 * write lock they need.
 */
async function awaitSettledJobs(
    app: Awaited<ReturnType<typeof bootstrap>>,
    timeoutMs = 180_000,
): Promise<void> {
    await app.get(JobQueueService).flush();
    const strategy = app.get(ConfigService).jobQueueOptions.jobQueueStrategy as {
        findMany?: (options: unknown) => Promise<{ totalItems: number }>;
    };
    if (!strategy.findMany) {
        return;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { totalItems } = await strategy.findMany({ filter: { isSettled: { eq: false } } });
        if (totalItems === 0) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Jobs were still running after ${timeoutMs / 1000}s`);
}
