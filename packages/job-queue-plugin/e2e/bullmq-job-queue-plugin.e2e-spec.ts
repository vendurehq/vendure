import { Injectable, OnModuleInit } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { JobState } from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    DefaultLogger,
    isInspectableJobQueueStrategy,
    JobQueue,
    JobQueueService,
    LogLevel,
    mergeConfig,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { randomUUID } from 'crypto';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { awaitRunningJobs } from '../../core/e2e/utils/await-running-jobs';
import { BullMQJobQueuePlugin } from '../src/bullmq/plugin';

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const CUSTOM_ID_QUEUE = 'custom-job-id-test';

@Injectable()
class CustomIdTestService implements OnModuleInit {
    queue: JobQueue<{ n: number }>;

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: CUSTOM_ID_QUEUE,
            process: () => Promise.resolve('ok'),
        });
    }
}

// A Shop API type which happens to be named `Job`, unrelated to the job queue
@Resolver()
class ShopJobResolver {
    @Query()
    job(@Args() args: { id: string }) {
        return { id: args.id, receivedId: String(args.id) };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [CustomIdTestService],
    shopApiExtensions: {
        schema: gql`
            type Job {
                id: ID!
                receivedId: String!
            }
            extend type Query {
                job(id: ID!): Job
            }
        `,
        resolvers: [ShopJobResolver],
    },
})
class CustomIdTestPlugin {}

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
                    setJobOptions: queueName =>
                        queueName === CUSTOM_ID_QUEUE ? { jobId: `custom-${randomUUID()}` } : {},
                }),
                CustomIdTestPlugin,
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

    // #5558 — Admin API job queries should find BullMQ jobs that have a custom jobId
    describe('jobs with a custom jobId', () => {
        let customJobId: string;

        beforeAll(async () => {
            const job = await server.app.get(CustomIdTestService).queue.add({ n: 1 });
            customJobId = job.id as string;
            expect(customJobId).toMatch(/^custom-/);

            // Wait for the job to complete, reading it directly from the strategy so that
            // the wait does not depend on the Admin API queries under test.
            const strategy = server.app.get(ConfigService).jobQueueOptions.jobQueueStrategy;
            if (!isInspectableJobQueueStrategy(strategy)) {
                throw new Error('Expected an InspectableJobQueueStrategy');
            }
            const started = Date.now();
            while ((await strategy.findOne(customJobId))?.state !== JobState.COMPLETED) {
                if (Date.now() - started > 10_000) {
                    throw new Error('Timed out waiting for the custom id job to complete');
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        });

        it('job query returns the job', async () => {
            const { job } = await adminClient.query(GET_JOB, { id: customJobId });

            expect(job).not.toBeNull();
            expect(job.id).toBe(customJobId);
            expect(job.state).toBe(JobState.COMPLETED);
        });

        it('jobsById query returns the job', async () => {
            const { jobsById } = await adminClient.query(GET_JOBS_BY_ID, { ids: [customJobId] });

            expect(jobsById.map((j: { id: string }) => j.id)).toEqual([customJobId]);
        });

        it('the job id returned by the Admin API can be used to query the job again', async () => {
            const { jobsById } = await adminClient.query(GET_JOBS_BY_ID, { ids: [customJobId] });
            const { job } = await adminClient.query(GET_JOB, { id: jobsById[0].id });

            expect(job).not.toBeNull();
            expect(job.id).toBe(jobsById[0].id);
        });

        // Job ids are only left as they are in the Admin API
        it('still transforms the ids of a Shop API type which is also named Job', async () => {
            const { job } = await shopClient.query(GET_SHOP_JOB, { id: 'T_5' });

            expect(job).toEqual({ id: 'T_5', receivedId: '5' });
        });

        it('cancelJob mutation finds the job', async () => {
            const { cancelJob } = await adminClient.query(CANCEL_JOB, { id: customJobId });

            expect(cancelJob.id).toBe(customJobId);
        });
    });
});

const GET_JOB = gql`
    query GetJobById($id: ID!) {
        job(jobId: $id) {
            id
            state
        }
    }
`;

const GET_JOBS_BY_ID = gql`
    query GetJobsByIds($ids: [ID!]!) {
        jobsById(jobIds: $ids) {
            id
            state
        }
    }
`;

const GET_SHOP_JOB = gql`
    query GetShopJob($id: ID!) {
        job(id: $id) {
            id
            receivedId
        }
    }
`;

const CANCEL_JOB = gql`
    mutation CancelJobById($id: ID!) {
        cancelJob(jobId: $id) {
            id
            state
        }
    }
`;
