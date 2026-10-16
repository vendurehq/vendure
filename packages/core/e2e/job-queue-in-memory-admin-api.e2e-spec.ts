import { JobState } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { PluginWithJobQueue } from './fixtures/test-plugins/with-job-queue';
import { graphql } from './graphql/graphql-admin';
import { cancelJobDocument, getRunningJobsDocument } from './graphql/shared-definitions';
import { pollUntil } from './utils/poll-until';

const getJobDocument = graphql(`
    query GetJob($id: ID!) {
        job(jobId: $id) {
            id
            state
        }
    }
`);

const getJobsByIdDocument = graphql(`
    query GetJobsById($ids: [ID!]!) {
        jobsById(jobIds: $ids) {
            id
            state
        }
    }
`);

// Job queue on the default InMemoryJobQueueStrategy (no job queue plugin).
// #5439: Admin API job lookups. #5292: job updates read through the strategy's finders.
describe('JobQueue with InMemoryJobQueueStrategy', () => {
    const activeConfig = testConfig();
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [PluginWithJobQueue],
        }),
    );
    const baseUrl = `http://localhost:${activeConfig.apiOptions.port}/run-job`;
    let runningJobId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        await adminClient.fetch(baseUrl);
        await pollUntil(async () => {
            const { jobs } = await adminClient.query(getRunningJobsDocument, {
                options: { filter: { queueName: { eq: 'test' }, state: { eq: JobState.RUNNING } } },
            });
            runningJobId = jobs.items[0]?.id;
            return !!runningJobId;
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        PluginWithJobQueue.jobSubject.complete();
        await server.destroy();
    });

    it('job returns the job by id', async () => {
        const { job } = await adminClient.query(getJobDocument, { id: runningJobId });
        expect(job?.id).toBe(runningJobId);
        expect(job?.state).toBe(JobState.RUNNING);
    });

    it('jobsById returns the jobs by id', async () => {
        const { jobsById } = await adminClient.query(getJobsByIdDocument, { ids: [runningJobId] });
        expect(jobsById.map(j => j.id)).toEqual([runningJobId]);
    });

    it('jobs filtered by id returns the job', async () => {
        const { jobs } = await adminClient.query(getRunningJobsDocument, {
            options: { filter: { id: { eq: runningJobId } } },
        });
        expect(jobs.items.map(j => j.id)).toEqual([runningJobId]);
    });

    it('cancelJob cancels the job', async () => {
        const { cancelJob } = await adminClient.query(cancelJobDocument, { id: runningJobId });
        expect(cancelJob.id).toBe(runningJobId);
        expect(cancelJob.state).toBe(JobState.CANCELLED);

        const { job } = await adminClient.query(getJobDocument, { id: runningJobId });
        expect(job?.state).toBe(JobState.CANCELLED);
    });

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
});
