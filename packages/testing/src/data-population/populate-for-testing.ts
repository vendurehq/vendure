/* eslint-disable no-console */
import { INestApplicationContext } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ConfigService, isInspectableJobQueueStrategy, VendureConfig } from '@vendure/core';
import { importProductsFromCsv, populateCollections, populateInitialData } from '@vendure/core/cli';

import { TestServerOptions } from '../types';

import { populateCustomers } from './populate-customers';

/* eslint-disable @typescript-eslint/no-floating-promises */
/**
 * Clears all tables from the database and populates with (deterministic) random data.
 */
export async function populateForTesting<T extends INestApplicationContext>(
    config: Required<VendureConfig>,
    bootstrapFn: (config: VendureConfig) => Promise<T>,
    options: TestServerOptions,
): Promise<T> {
    (config.dbConnectionOptions as any).logging = false;
    const logging = options.logging === undefined ? true : options.logging;
    const originalRequireVerification = config.authOptions.requireVerification;
    config.authOptions.requireVerification = false;

    const app = await bootstrapFn(config);
    await awaitOutstandingJobs(app);

    const logFn = (message: string) => (logging ? console.log(message) : null);

    await populateInitialData(app, options.initialData);
    await populateProducts(app, options.productsCsvPath, logging);
    await populateCollections(app, options.initialData);
    await populateCustomers(app, options.customerCount ?? 10, logFn);

    config.authOptions.requireVerification = originalRequireVerification;
    return app;
}

/**
 * Sometimes there will be jobs created during the bootstrap process, e.g. when
 * a plugin needs to create certain entities during bootstrap, which might then
 * trigger e.g. search index update jobs. This can lead to very hard-to-debug
 * failures in e2e tests suites (specifically at this moment, consistent failures
 * of the sql.js tests on Node v20).
 *
 * This function will wait for all outstanding jobs to finish before returning.
 */
async function awaitOutstandingJobs(app: INestApplicationContext) {
    const { jobQueueStrategy } = app.get(ConfigService).jobQueueOptions;
    const maxAttempts = 10;
    let attempts = 0;
    if (isInspectableJobQueueStrategy(jobQueueStrategy)) {
        const inspectableJobQueueStrategy = jobQueueStrategy;

        function waitForJobQueueToBeIdle() {
            return new Promise<void>(resolve => {
                const interval = setInterval(async () => {
                    attempts++;
                    const { items } = await inspectableJobQueueStrategy.findMany();
                    const jobsOutstanding = items.filter(i => i.state === 'RUNNING' || i.state === 'PENDING');
                    if (jobsOutstanding.length === 0 || attempts >= maxAttempts) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 500);
            });
        }

        await waitForJobQueueToBeIdle();
    }
}

async function populateProducts(
    app: INestApplicationContext,
    productsCsvPath: string | undefined,
    logging: boolean,
) {
    if (!productsCsvPath) {
        if (logging) {
            console.log('\nNo product data provided, skipping product import');
        }
        return;
    }

    const importResult = await importProductsFromCsv(app, productsCsvPath, LanguageCode.en);
    if (importResult.errors && importResult.errors.length) {
        console.log(`${importResult.errors.length} errors encountered when importing product data:`);
        console.log(importResult.errors.join('\n'));
    }

    if (logging) {
        console.log(`\nImported ${importResult.imported} products`);
    }
}
