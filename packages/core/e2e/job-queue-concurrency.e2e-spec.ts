import { OnApplicationBootstrap } from '@nestjs/common';
import {
    DefaultJobQueuePlugin,
    JobQueue,
    JobQueueService,
    mergeConfig,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

@VendurePlugin({
    imports: [PluginCommonModule],
})
class ConcurrencyTestPlugin implements OnApplicationBootstrap {
    static slowQueueMaxConcurrent = 0;
    static fastQueueMaxConcurrent = 0;
    static slowQueueCurrent = 0;
    static fastQueueCurrent = 0;
    static processedJobs: string[] = [];
    static slowQueue: JobQueue<{ id: number }>;
    static fastQueue: JobQueue<{ id: number }>;

    constructor(private jobQueueService: JobQueueService) {}

    async onApplicationBootstrap() {
        ConcurrencyTestPlugin.slowQueue = await this.jobQueueService.createQueue({
            name: 'test-slow-queue',
            process: async job => {
                ConcurrencyTestPlugin.slowQueueCurrent++;
                ConcurrencyTestPlugin.slowQueueMaxConcurrent = Math.max(
                    ConcurrencyTestPlugin.slowQueueMaxConcurrent,
                    ConcurrencyTestPlugin.slowQueueCurrent,
                );
                await new Promise(resolve => setTimeout(resolve, 100));
                ConcurrencyTestPlugin.slowQueueCurrent--;
                ConcurrencyTestPlugin.processedJobs.push(`slow-${job.data.id}`);
                return job.data;
            },
        });

        ConcurrencyTestPlugin.fastQueue = await this.jobQueueService.createQueue({
            name: 'test-fast-queue',
            process: async job => {
                ConcurrencyTestPlugin.fastQueueCurrent++;
                ConcurrencyTestPlugin.fastQueueMaxConcurrent = Math.max(
                    ConcurrencyTestPlugin.fastQueueMaxConcurrent,
                    ConcurrencyTestPlugin.fastQueueCurrent,
                );
                await new Promise(resolve => setTimeout(resolve, 100));
                ConcurrencyTestPlugin.fastQueueCurrent--;
                ConcurrencyTestPlugin.processedJobs.push(`fast-${job.data.id}`);
                return job.data;
            },
        });
    }

    static reset() {
        this.slowQueueMaxConcurrent = 0;
        this.fastQueueMaxConcurrent = 0;
        this.slowQueueCurrent = 0;
        this.fastQueueCurrent = 0;
        this.processedJobs = [];
    }
}

describe('Job queue per-queue concurrency', () => {
    const activeConfig = testConfig();
    if (activeConfig.dbConnectionOptions.type === 'sqljs') {
        it.only('skip per-queue concurrency tests for sqljs', () => {
            // The tests in this suite will fail when running on sqljs because
            // the DB state is not persisted correctly with the polling nature
            // of the SQL job queue strategy.
            return;
        });
    }

    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [
                DefaultJobQueuePlugin.init({
                    pollInterval: 50,
                    concurrency: (queueName: string) => {
                        if (queueName === 'test-slow-queue') {
                            return 1;
                        }
                        return 3;
                    },
                }),
                ConcurrencyTestPlugin,
            ],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-empty.csv'),
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('should respect per-queue concurrency limits', async () => {
        ConcurrencyTestPlugin.reset();

        // Add 5 jobs to each queue
        const jobPromises: Array<Promise<any>> = [];
        for (let i = 0; i < 5; i++) {
            jobPromises.push(ConcurrencyTestPlugin.slowQueue.add({ id: i }));
            jobPromises.push(ConcurrencyTestPlugin.fastQueue.add({ id: i }));
        }
        await Promise.all(jobPromises);

        // Wait for all jobs to complete (5 jobs * 100ms each / concurrency + buffer)
        // slow-queue: 5 jobs / 1 concurrency = 500ms
        // fast-queue: 5 jobs / 3 concurrency = ~200ms
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Verify slow queue never exceeded concurrency of 1
        expect(ConcurrencyTestPlugin.slowQueueMaxConcurrent).toBe(1);

        // Verify fast queue processed multiple jobs concurrently
        expect(ConcurrencyTestPlugin.fastQueueMaxConcurrent).toBeGreaterThan(1);
        expect(ConcurrencyTestPlugin.fastQueueMaxConcurrent).toBeLessThanOrEqual(3);

        // Verify all jobs were processed
        expect(ConcurrencyTestPlugin.processedJobs.filter(j => j.startsWith('slow-')).length).toBe(5);
        expect(ConcurrencyTestPlugin.processedJobs.filter(j => j.startsWith('fast-')).length).toBe(5);
    });
});
