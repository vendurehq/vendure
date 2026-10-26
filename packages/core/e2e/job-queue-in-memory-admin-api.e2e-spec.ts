import { OnApplicationBootstrap } from '@nestjs/common';
import { JobState } from '@vendure/common/lib/generated-types';
import {
    JobQueue,
    JobQueueService,
    mergeConfig,
    PluginCommonModule,
    RequestContextService,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { PluginWithJobQueue } from './fixtures/test-plugins/with-job-queue';
import { graphql } from './graphql/graphql-admin';
import { cancelJobDocument, getRunningJobsDocument } from './graphql/shared-definitions';
import { pollUntil } from './utils/poll-until';

let mailQueue: JobQueue<any> | undefined;

@VendurePlugin({ imports: [PluginCommonModule] })
class MailQueuePlugin implements OnApplicationBootstrap {
    constructor(private jobQueueService: JobQueueService) {}

    async onApplicationBootstrap() {
        mailQueue = await this.jobQueueService.createQueue<any>({
            name: 'in-memory-send-email',
            process: () => Promise.resolve(),
        });
    }
}

const getJobDataDocument = graphql(`
    query GetJobData($id: ID!) {
        job(jobId: $id) {
            id
            data
        }
    }
`);

const getJobsDataDocument = graphql(`
    query GetJobsData($options: JobListOptions) {
        jobs(options: $options) {
            items {
                id
                data
            }
        }
    }
`);

const getJobsByIdDataDocument = graphql(`
    query GetJobsByIdData($ids: [ID!]!) {
        jobsById(jobIds: $ids) {
            id
            data
        }
    }
`);

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

// #5439: Admin API job lookups on the default InMemoryJobQueueStrategy (no job queue plugin)
describe('JobQueue Admin API with InMemoryJobQueueStrategy', () => {
    const activeConfig = testConfig();
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [PluginWithJobQueue, MailQueuePlugin],
        }),
    );
    let runningJobId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        await adminClient.fetch(`http://localhost:${activeConfig.apiOptions.port}/run-job`);
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

    // Jobs held by the InMemoryJobQueueStrategy go through the same
    // redaction as jobs read from the database. That job.data is not mutated is covered by
    // job-entity.resolver.spec.ts, because this strategy already returns copies.
    it('job, jobs and jobsById redact credentials from in-memory job data', async () => {
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        if (!mailQueue) {
            throw new Error('The in-memory-send-email queue was not created');
        }
        const added = await mailQueue.add({
            ctx: ctx.serialize(),
            type: 'password-reset',
            recipient: 'in-memory@test.com',
            templateVars: { passwordResetToken: 'e2e-secret-in-memory-reset-token' },
            user: { authenticationMethods: [{ passwordHash: 'e2e-secret-in-memory-password-hash' }] },
            attachments: [
                { filename: 'a.txt', content: '"e2e-secret-in-memory-content"', path: '/tmp/a.txt' },
            ],
        });
        const jobId = `T_${String(added.id)}`;

        const { job } = await adminClient.query(getJobDataDocument, { id: jobId });
        const { jobs } = await adminClient.query(getJobsDataDocument, {
            options: { filter: { id: { eq: jobId } } },
        });
        const { jobsById } = await adminClient.query(getJobsByIdDataDocument, { ids: [jobId] });

        const responses = [job, ...jobs.items, ...jobsById];
        expect(responses.map(j => j?.id)).toEqual([jobId, jobId, jobId]);
        const serialized = JSON.stringify(responses);
        expect(serialized).not.toContain('e2e-secret-in-memory-reset-token');
        expect(serialized).not.toContain('e2e-secret-in-memory-password-hash');
        expect(serialized).not.toContain('e2e-secret-in-memory-content');
    });
});
