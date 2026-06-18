import { DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { awaitRunningJobs } from '../../core/e2e/utils/await-running-jobs';
import { BullMQJobQueuePlugin } from '../src/bullmq/plugin';

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;

describe('BullMQJobQueuePlugin', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: {
                port: 4050,
            },
            logger: new DefaultLogger({ level: LogLevel.Info }),
            plugins: [
                BullMQJobQueuePlugin.init({
                    connection: {
                        host: redisHost,
                        port: redisPort,
                        maxRetriesPerRequest: null,
                    },
                    workerOptions: {
                        prefix: 'e2e',
                    },
                    queueOptions: {
                        prefix: 'e2e',
                    },
                }),
            ],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
        // redis.quit() creates a thread to close the connection.
        // We wait until all threads have been run once to ensure the connection closes.
        // See https://stackoverflow.com/a/54560610/772859
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('works', () => {
        expect(1).toBe(1);
    });
});
