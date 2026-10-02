/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { JobState } from '@vendure/common/lib/generated-types';
import { ConfigService, InspectableJobQueueStrategy, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { PluginWithJobQueue } from './fixtures/test-plugins/with-job-queue';
import { getRunningJobsDocument } from './graphql/shared-definitions';
import { pollUntil } from './utils/poll-until';

// #5292 — job queue flows on the default InMemoryJobQueueStrategy (no job queue plugin)
describe('JobQueue with InMemoryJobQueueStrategy', () => {
    const activeConfig = testConfig();
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [PluginWithJobQueue],
        }),
    );
    const baseUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job`;
    let strategy: InspectableJobQueueStrategy;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        strategy = server.app.get(ConfigService).jobQueueOptions
            .jobQueueStrategy as unknown as InspectableJobQueueStrategy;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        PluginWithJobQueue.jobSubject.complete();
        await server.destroy();
    });

    async function getTestJobs(state?: JobState) {
        const { items } = await strategy.findMany({
            filter: { queueName: { eq: 'test' }, ...(state ? { state: { eq: state } } : {}) },
        });
        return items;
    }

    it('updates() emits until the job completes', async () => {
        const response = await adminClient.fetch(`${baseUrl}/subscribe-all-updates`);
        const result = JSON.parse(await response.text());
        expect(result.updateCount).toBeGreaterThanOrEqual(3);
        expect(result.finalState).toBe(JobState.COMPLETED);
        expect(result.finalResult).toBe('completed');
    });

    it('subscribe to result of job', async () => {
        const response = await adminClient.fetch(`${baseUrl}/subscribe`);
        expect(await response.text()).toBe('42!');
    });

    // The admin API `cancelJob` mutation decodes its ID to a number, which misses the in-memory
    // store's string keys, so cancel through the strategy the server is running.
    it('a PENDING job cancelled before it runs is never processed', async () => {
        await adminClient.fetch(baseUrl);
        await pollUntil(async () => (await getTestJobs(JobState.RUNNING)).length === 1);
        const runningId = (await getTestJobs(JobState.RUNNING))[0].id!;

        await adminClient.fetch(baseUrl);
        await pollUntil(async () => (await getTestJobs(JobState.PENDING)).length === 1);
        const pendingId = (await getTestJobs(JobState.PENDING))[0].id!;

        const cancelled = await strategy.cancelJob(pendingId);
        expect(cancelled?.state).toBe(JobState.CANCELLED);

        PluginWithJobQueue.jobSubject.next();
        await pollUntil(async () => (await strategy.findOne(runningId))?.state === JobState.COMPLETED);
        // a dispatched job would notice CANCELLED on the fixture's 500ms tick and settle as COMPLETED
        await new Promise(r => setTimeout(r, 1500));

        expect((await strategy.findOne(pendingId))?.state).toBe(JobState.CANCELLED);
        expect((await getTestJobs(JobState.RUNNING)).length).toBe(0);
    });

    it('cancelling a RUNNING job reaches the job being processed', async () => {
        await adminClient.fetch(baseUrl);
        await pollUntil(async () => (await getTestJobs(JobState.RUNNING)).length === 1);
        const jobId = (await getTestJobs(JobState.RUNNING))[0].id!;

        const cancelled = await strategy.cancelJob(jobId);
        expect(cancelled?.state).toBe(JobState.CANCELLED);
        expect((await strategy.findOne(jobId))?.state).toBe(JobState.CANCELLED);
        // the fixture job polls its own state every 500ms and returns once it sees CANCELLED
        await pollUntil(async () => (await getTestJobs(JobState.RUNNING)).length === 0);
    });

    it('jobs list paginates with totalItems of all matches', async () => {
        const { jobs } = await adminClient.query(getRunningJobsDocument, {
            options: { take: 1, filter: { queueName: { eq: 'test' } } },
        });
        expect(jobs.items.length).toBe(1);
        expect(jobs.totalItems).toBeGreaterThan(1);
    });
});
