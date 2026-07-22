import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobState } from '@vendure/common/lib/generated-types';
import {
    DefaultLogger,
    JobQueue,
    JobQueueService,
    LogLevel,
    mergeConfig,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import Redis from 'ioredis';
import path from 'path';
import { firstValueFrom, Subject } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { JobListIndexService } from '../src/bullmq/job-list-index.service';
import { BullMQJobQueuePlugin } from '../src/bullmq/plugin';

/**
 * These tests exercise the `jobs` list query through the full stack (GraphQL admin API ->
 * BullMQJobQueueStrategy.findMany() -> getJobsByType Lua script -> Redis) with jobs in a
 * realistic mixture of states:
 *
 * - completed jobs (in BullMQ's `completed` sorted set)
 * - a job awaiting a retry after failure (in the `delayed` sorted set)
 * - a running job (in the `active` list)
 * - queued jobs backed up behind it (in the `wait` list)
 *
 * The queue worker runs with concurrency 1, and the running job blocks until released in
 * afterAll, so the state mixture stays stable while the assertions run.
 *
 * Several of these tests currently fail, demonstrating known defects in the list query.
 * They should all pass once those defects are fixed.
 */

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const PREFIX = 'joblist-e2e';

@Injectable()
class ListTestService implements OnModuleInit {
    static releaseBlocker$ = new Subject<void>();
    fastOne: JobQueue<{ n: number }>;
    fastTwo: JobQueue<{ n: number }>;
    flaky: JobQueue<{ n: number }>;
    blocker: JobQueue<{ n: number }>;
    filler: JobQueue<{ n: number }>;

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit() {
        this.fastOne = await this.jobQueueService.createQueue({
            name: 'list-fast-one',
            process: async () => 'ok',
        });
        this.fastTwo = await this.jobQueueService.createQueue({
            name: 'list-fast-two',
            process: async () => 'ok',
        });
        this.flaky = await this.jobQueueService.createQueue({
            name: 'list-flaky',
            process: async () => {
                throw new Error('deliberate failure');
            },
        });
        this.blocker = await this.jobQueueService.createQueue({
            name: 'list-blocker',
            process: async () => {
                await firstValueFrom(ListTestService.releaseBlocker$);
                return 'released';
            },
        });
        this.filler = await this.jobQueueService.createQueue({
            name: 'list-filler',
            process: async () => 'ok',
        });
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [ListTestService],
})
class ListTestPlugin {}

const GET_JOBS = gql`
    query GetJobList($options: JobListOptions) {
        jobs(options: $options) {
            totalItems
            items {
                id
                queueName
                state
            }
        }
    }
`;

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

const CANCEL_JOB = gql`
    mutation CancelJobById($id: ID!) {
        cancelJob(jobId: $id) {
            id
            state
        }
    }
`;

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('BullMQ job list query', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            logger: new DefaultLogger({ level: LogLevel.Warn }),
            plugins: [
                BullMQJobQueuePlugin.init({
                    connection: {
                        host: redisHost,
                        port: redisPort,
                        maxRetriesPerRequest: null,
                    },
                    workerOptions: {
                        prefix: PREFIX,
                    },
                    queueOptions: {
                        prefix: PREFIX,
                    },
                    // A single worker slot, so the blocker job below keeps all
                    // filler jobs parked in the `wait` list.
                    concurrency: 1,
                    // Park failed jobs in the `delayed` state for long enough that
                    // they remain there for the whole test run.
                    setBackoff: () => ({ type: 'fixed', delay: 5 * 60_000 }),
                }),
                ListTestPlugin,
            ],
        }),
    );

    const cleanupRedis = new Redis({ host: redisHost, port: redisPort, maxRetriesPerRequest: null });

    // Ids of the jobs created in beforeAll, in creation order
    const fastOneIds: string[] = [];
    const fastTwoIds: string[] = [];
    let flakyId: string;
    let blockerId: string;
    const fillerIds: string[] = [];
    let removedId: string | undefined;

    function allKnownIdsInCreationOrder(): string[] {
        return [...fastOneIds, ...fastTwoIds, flakyId, blockerId, ...fillerIds];
    }

    async function waitFor(condition: () => Promise<boolean>, label: string, timeoutMs = 20_000) {
        const started = Date.now();
        do {
            if (await condition()) {
                return;
            }
            await sleep(200);
        } while (Date.now() - started < timeoutMs);
        throw new Error(`Timed out waiting for: ${label}`);
    }

    // The e2e testConfig uses an entity id strategy which prefixes all ids in API
    // responses with "T_", so we strip it to compare against the raw BullMQ job ids.
    function normalizeId(id: string): string {
        return id.replace(/^T_/, '');
    }

    function requireJobId(job: { id?: string | number }): string {
        if (job.id == null) {
            throw new Error('Expected job to have an id');
        }
        return job.id.toString();
    }

    async function getJobs(options: any) {
        const { jobs } = await adminClient.query(GET_JOBS, { options });
        return {
            totalItems: jobs.totalItems as number,
            items: (jobs.items as Array<{ id: string; queueName: string; state: string }>).map(item => ({
                ...item,
                id: normalizeId(item.id),
            })),
        };
    }

    /**
     * Writes entries to the indexed sorted sets exactly as a correctly-functioning
     * JobListIndexService would. This lets the tests below demonstrate defects in the
     * *query* side of the indexed sets independently of the (also broken) event-driven
     * index maintenance, which never runs because the QueueEvents instance listens on
     * the wrong Redis prefix.
     */
    async function seedIndexEntries(queueName: string, state: string, ids: string[]) {
        await cleanupRedis.sadd(`${PREFIX}:vendure-job-queue:queue-names`, queueName);
        for (const id of ids) {
            const timestamp = await cleanupRedis.hget(`${PREFIX}:vendure-job-queue:${id}`, 'timestamp');
            await cleanupRedis.zadd(
                `${PREFIX}:vendure-job-queue:queue:${queueName}:${state}`,
                Number(timestamp),
                id,
            );
        }
    }

    async function jobsAreInState(ids: string[], state: JobState): Promise<boolean> {
        const { jobsById } = await adminClient.query(GET_JOBS_BY_ID, { ids });
        return (
            jobsById.length === ids.length && jobsById.every((j: { state: string }) => j.state === state)
        );
    }

    beforeAll(async () => {
        // Remove leftover keys from previous runs so counts are predictable
        let cursor = '0';
        do {
            const [nextCursor, keys] = await cleanupRedis.scan(
                cursor,
                'MATCH',
                `${PREFIX}:*`,
                'COUNT',
                1000,
            );
            cursor = nextCursor;
            if (keys.length) {
                await cleanupRedis.del(...keys);
            }
        } while (cursor !== '0');

        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // The JobListIndexService only maintains its indexed sets in the worker
        // process, but the test server runs as a single process in the 'server'
        // context. To mirror a production deployment (where the worker maintains
        // the index that the server then reads), we patch the process context and
        // register the event listeners manually.
        const indexService: any = server.app.get(JobListIndexService);
        indexService.processContext = { isServer: false, isWorker: true };
        indexService.setupEventListeners();

        const service = server.app.get(ListTestService);

        // 1. Completed jobs on two queues. Jobs are added with small gaps so that
        // every job has a distinct creation timestamp, making ordering assertions
        // deterministic.
        for (let i = 1; i <= 3; i++) {
            const job = await service.fastOne.add({ n: i });
            fastOneIds.push(requireJobId(job));
            await sleep(20);
        }
        for (let i = 1; i <= 2; i++) {
            const job = await service.fastTwo.add({ n: i });
            fastTwoIds.push(requireJobId(job));
            await sleep(20);
        }
        await waitFor(
            () => jobsAreInState([...fastOneIds, ...fastTwoIds], JobState.COMPLETED),
            'fast jobs to complete',
        );

        // 2. A job which fails and awaits a retry in 5 minutes, i.e. sits in the
        // `delayed` state for the rest of the test run.
        const flakyJob = await service.flaky.add({ n: 1 }, { retries: 1 });
        flakyId = requireJobId(flakyJob);
        await waitFor(() => jobsAreInState([flakyId], JobState.RETRYING), 'flaky job to await retry');
        await sleep(20);

        // 3. A job which blocks the single worker slot until released in afterAll.
        const blockerJob = await service.blocker.add({ n: 1 });
        blockerId = requireJobId(blockerJob);
        await waitFor(() => jobsAreInState([blockerId], JobState.RUNNING), 'blocker job to start');
        await sleep(20);

        // 4. Jobs queued up behind the blocker, i.e. in the `wait` list.
        for (let i = 1; i <= 8; i++) {
            const job = await service.filler.add({ n: i });
            fillerIds.push(requireJobId(job));
            await sleep(20);
        }
        await waitFor(() => jobsAreInState(fillerIds, JobState.PENDING), 'filler jobs to be queued');
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        // Release the blocker so that it and the filler jobs can complete, allowing
        // the worker to shut down gracefully.
        ListTestService.releaseBlocker$.next();
        try {
            await waitFor(
                () => jobsAreInState([blockerId, ...fillerIds], JobState.COMPLETED),
                'blocked jobs to drain',
                10_000,
            );
        } catch (e: any) {
            // eslint-disable-next-line no-console
            console.log(e.message);
        }
        // The JobListIndexService never closes its QueueEvents connection, so we do it
        // here to avoid a dangling Redis connection keeping the process alive.
        const jobListIndexService = server.app.get(JobListIndexService);
        await (jobListIndexService as any).queueEvents?.close();
        await server.destroy();
        await cleanupRedis.quit();
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('lists jobs of all states with correct state mapping', async () => {
        // Calibration test: all seeded jobs are visible in a single large page with the
        // expected JobState. This passes with the current implementation and proves the
        // suite's setup assumptions hold.
        const { items } = await getJobs({ take: 100 });
        const byId = new Map(items.map(item => [item.id, item]));

        for (const id of [...fastOneIds, ...fastTwoIds]) {
            expect.soft(byId.get(id)?.state).toBe(JobState.COMPLETED);
        }
        expect.soft(byId.get(flakyId)?.state).toBe(JobState.RETRYING);
        expect.soft(byId.get(blockerId)?.state).toBe(JobState.RUNNING);
        for (const id of fillerIds) {
            expect.soft(byId.get(id)?.state).toBe(JobState.PENDING);
        }
    });

    it('keeps the job list index updated when a custom Redis prefix is configured', async () => {
        // The JobListIndexService maintains its indexed sets in response to QueueEvents.
        // The QueueEvents instance is created without the configured Redis prefix, so it
        // listens on the default 'bull'-prefixed events stream which this queue never
        // writes to — meaning the index is never updated after the initial startup
        // migration. The completed list-fast-one jobs must appear in the indexed set.
        const indexKey = `${PREFIX}:vendure-job-queue:queue:list-fast-one:completed`;
        let indexedIds: string[] = [];
        const started = Date.now();
        do {
            indexedIds = await cleanupRedis.zrange(indexKey, 0, -1);
            if (fastOneIds.every(id => indexedIds.includes(id))) {
                break;
            }
            await sleep(200);
        } while (Date.now() - started < 5000);

        expect(indexedIds).toEqual(expect.arrayContaining(fastOneIds));
    });

    it('returns jobs ordered newest-first regardless of state', async () => {
        // The jobs list should be ordered by creation time, newest first. The current
        // implementation emits list-stored jobs (active/wait) before sorted-set-stored
        // jobs (completed/delayed), so running & queued jobs always come before newer
        // completed jobs, and the retrying job sinks below the completed jobs that
        // were created before it.
        const { items } = await getJobs({ take: 100 });
        const knownIds = new Set(allKnownIdsInCreationOrder());
        const ourIdsInResponseOrder = items.map(item => item.id).filter(id => knownIds.has(id));

        const expectedNewestFirst = [...allKnownIdsInCreationOrder()].reverse();
        expect(ourIdsInResponseOrder).toEqual(expectedNewestFirst);
    });

    it('returns every job exactly once when paginating', async () => {
        // Walking through all pages must yield every job exactly once, and the number
        // of collected jobs must equal totalItems. The current implementation applies
        // `skip` twice when the results span both list-stored and sorted-set-stored
        // states, silently dropping jobs from pages.
        const take = 5;
        const { totalItems } = await getJobs({ take, skip: 0 });
        const collected: string[] = [];
        for (let skip = 0; skip < totalItems; skip += take) {
            const { items } = await getJobs({ take, skip });
            collected.push(...items.map(item => item.id));
        }

        expect(new Set(collected).size).toBe(collected.length);
        for (const id of allKnownIdsInCreationOrder()) {
            expect.soft(collected, `job ${id} missing from paginated results`).toContain(id);
        }
        expect(collected.length).toBe(totalItems);
    });

    it('filtering by RETRYING state returns jobs awaiting a retry', async () => {
        // The single-job query correctly reports the flaky job as RETRYING (it is in
        // BullMQ's `delayed` state awaiting its retry), so the list query filtered by
        // RETRYING must include it. The current implementation maps the RETRYING filter
        // to the 'repeat' job type, which holds repeatable-job configs, not retrying
        // jobs — so the filter returns nothing.
        const { job } = await adminClient.query(GET_JOB, { id: flakyId });
        expect(job.state).toBe(JobState.RETRYING);

        const { items } = await getJobs({ filter: { state: { eq: JobState.RETRYING } } });
        expect(items.map(item => item.id)).toContain(flakyId);
    });

    it('filtering by multiple queue names returns jobs from all of them', async () => {
        await seedIndexEntries('list-fast-one', 'completed', fastOneIds);
        await seedIndexEntries('list-fast-two', 'completed', fastTwoIds);

        // Sanity check: each single-queue filter works against the seeded index.
        const one = await getJobs({ filter: { queueName: { eq: 'list-fast-one' } } });
        const two = await getJobs({ filter: { queueName: { eq: 'list-fast-two' } } });
        expect(one.items.map(item => item.id).sort()).toEqual([...fastOneIds].sort());
        expect(two.items.map(item => item.id).sort()).toEqual([...fastTwoIds].sort());

        // The current implementation only uses the first entry of the `in` array,
        // silently dropping all other queue names from the filter.
        const { items } = await getJobs({
            filter: { queueName: { in: ['list-fast-one', 'list-fast-two'] } },
        });
        const returnedIds = items.map(item => item.id);
        for (const id of [...fastOneIds, ...fastTwoIds]) {
            expect.soft(returnedIds, `job ${id} missing from multi-queue filter`).toContain(id);
        }
    });

    it('reports consistent totals after a job is removed', async () => {
        await seedIndexEntries('list-fast-two', 'completed', fastTwoIds);
        const two = await getJobs({ filter: { queueName: { eq: 'list-fast-two' } } });
        expect(two.items.length).toBe(2);

        // Cancelling a settled job removes it from the queue entirely. The plugin's
        // 'removed' event handler then tries to look up the already-deleted job to
        // find its queue name, fails, and leaves the indexed set entry behind — so
        // totalItems keeps counting the removed job while items no longer contains it.
        removedId = fastTwoIds[0];
        await adminClient.query(CANCEL_JOB, { id: removedId });
        // Allow the 'removed' event to be delivered and processed
        await sleep(1500);

        const { totalItems, items } = await getJobs({ filter: { queueName: { eq: 'list-fast-two' } } });
        expect(items.map(item => item.id)).not.toContain(removedId);
        expect(items.length).toBe(totalItems);
    });
});
