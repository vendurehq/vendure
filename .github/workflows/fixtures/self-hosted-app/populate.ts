/* eslint-disable no-console */
import { bootstrap, DefaultLogger, JobQueueService, LogLevel } from '@vendure/core';
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
    // The search index is rebuilt by jobs that run after the import.
    .then(app => new Promise(resolve => setTimeout(() => resolve(app), 10_000)))
    .then(app => (app as { close(): Promise<void> }).close())
    .then(() => process.exit(0))
    .catch(err => {
        console.log(err);
        process.exit(1);
    });
