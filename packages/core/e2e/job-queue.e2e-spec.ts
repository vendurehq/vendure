import { JobState } from '@vendure/common/lib/generated-types';
import { DefaultJobQueuePlugin, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { PluginWithJobQueue } from './fixtures/test-plugins/with-job-queue';
import { cancelJobDocument, getRunningJobsDocument } from './graphql/shared-definitions';

describe('JobQueue', () => {
    const activeConfig = testConfig();
    if (activeConfig.dbConnectionOptions.type === 'sqljs') {
        it.only('skip JobQueue tests for sqljs', () => {
            // The tests in this suite will fail when running on sqljs because
            // the DB state is not persisted after shutdown. In this case it is
            // an acceptable tradeoff to just skip them, since the other DB engines
            // _will_ run in CI, and sqljs is less of a production use-case anyway.
            return;
        });
    }

    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [
                DefaultJobQueuePlugin.init({
                    pollInterval: 50,
                    gracefulShutdownTimeout: 1_000,
                }),
                PluginWithJobQueue,
            ],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await sleep(1000);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        PluginWithJobQueue.jobSubject.complete();
        await server.destroy();
    });

    function getJobsInTestQueue(state?: JobState) {
        return adminClient
            .query(getRunningJobsDocument, {
                options: {
                    filter: {
                        queueName: {
                            eq: 'test',
                        },
                        ...(state
                            ? {
                                  state: { eq: state },
                              }
                            : {}),
                    },
                },
            })
            .then(data => data.jobs);
    }

    let testJobId: string;

    it('creates and starts running a job', async () => {
        const restControllerUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job`;
        await adminClient.fetch(restControllerUrl);

        await sleep(300);
        const jobs = await getJobsInTestQueue();

        expect(jobs.items.length).toBe(1);
        expect(jobs.items[0].state).toBe(JobState.RUNNING);
        expect(PluginWithJobQueue.jobHasDoneWork).toBe(false);
        testJobId = jobs.items[0].id;
    });

    it(
        'shutdown server before completing job',
        async () => {
            await server.destroy();
            await server.bootstrap();
            await adminClient.asSuperAdmin();

            await sleep(300);
            const jobs = await getJobsInTestQueue();

            expect(jobs.items.length).toBe(1);
            expect(jobs.items[0].state).toBe(JobState.RUNNING);
            expect(jobs.items[0].id).toBe(testJobId);
            expect(PluginWithJobQueue.jobHasDoneWork).toBe(false);
        },
        TEST_SETUP_TIMEOUT_MS,
    );

    it('complete job after restart', async () => {
        PluginWithJobQueue.jobSubject.next();

        await sleep(300);
        const jobs = await getJobsInTestQueue();

        expect(jobs.items.length).toBe(1);
        expect(jobs.items[0].state).toBe(JobState.COMPLETED);
        expect(jobs.items[0].id).toBe(testJobId);
        expect(PluginWithJobQueue.jobHasDoneWork).toBe(true);
    });

    it('cancels a running job', async () => {
        PluginWithJobQueue.jobHasDoneWork = false;
        const restControllerUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job`;
        await adminClient.fetch(restControllerUrl);

        await sleep(300);
        const jobs = await getJobsInTestQueue(JobState.RUNNING);

        expect(jobs.items.length).toBe(1);
        expect(jobs.items[0].state).toBe(JobState.RUNNING);
        expect(PluginWithJobQueue.jobHasDoneWork).toBe(false);
        const jobId = jobs.items[0].id;

        const { cancelJob } = await adminClient.query(cancelJobDocument, {
            id: jobId,
        });

        expect(cancelJob.state).toBe(JobState.CANCELLED);
        expect(cancelJob.isSettled).toBe(true);
        expect(cancelJob.settledAt).not.toBeNull();

        const jobs2 = await getJobsInTestQueue(JobState.CANCELLED);
        expect(jobs.items.length).toBe(1);
        expect(jobs.items[0].id).toBe(jobId);

        PluginWithJobQueue.jobSubject.next();
    });

    it('subscribe to result of job', async () => {
        const restControllerUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job/subscribe`;
        const result = await adminClient.fetch(restControllerUrl);

        expect(await result.text()).toBe('42!');
        const jobs = await getJobsInTestQueue(JobState.RUNNING);
        expect(jobs.items.length).toBe(0);
    });

    it('subscribable that times out', async () => {
        const restControllerUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job/subscribe-timeout`;
        const result = await adminClient.fetch(restControllerUrl);

        expect(result.status).toBe(200);
        expect(await result.text()).toBe('Job subscription timed out. The job may still be running');
        const jobs = await getJobsInTestQueue(JobState.RUNNING);
        expect(jobs.items.length).toBe(1);
    });

    it('server still running after timeout', async () => {
        const jobs = await getJobsInTestQueue(JobState.RUNNING);
        expect(jobs.items.length).toBe(1);
    });

    // https://github.com/vendure-ecommerce/vendure/issues/4112
    it('updates() should emit multiple times until job completes', async () => {
        const restControllerUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job/subscribe-all-updates`;
        const response = await adminClient.fetch(restControllerUrl);
        const result = JSON.parse(await response.text());

        // Job does 4 progress steps (25%, 50%, 75%, 100%), so we should see at least 3 distinct updates
        expect(result.updateCount).toBeGreaterThanOrEqual(3);
        // Final state should be COMPLETED
        expect(result.finalState).toBe(JobState.COMPLETED);
        // Final result should be what the job returned
        expect(result.finalResult).toBe('completed');
    });
});

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
