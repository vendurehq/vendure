import Redis from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ALL_JOB_TYPES } from '../src/bullmq/constants';
import { getJobsByType } from '../src/bullmq/scripts/get-jobs-by-type';

/**
 * These tests exercise the `getJobsByType` Lua script directly against a real Redis instance,
 * with data laid out exactly as BullMQ and the JobListIndexService store it:
 *
 * - `<prefix>wait`, `<prefix>active`, `<prefix>paused` are **lists** of job ids, newest at the head
 * - `<prefix>completed`, `<prefix>failed` are **sorted sets** scored by the finished timestamp
 * - `<prefix>delayed` is a **sorted set** scored by an encoded value (`ms * 4096 + n`)
 * - `<prefix>prioritized` is a **sorted set** scored by priority
 * - `<prefix>repeat` is a **sorted set** of repeatable-job config keys (not job ids!)
 * - `<prefix><jobId>` is a hash of job data including the `timestamp` (creation time) field
 * - `<prefix>queue:<queueName>:<state>` are the plugin's own indexed sorted sets,
 *   scored by creation timestamp
 *
 * Each test seeds this full layout and asserts the intended contract of the jobs list:
 * a paginated, newest-first (by creation time) listing which never drops, duplicates
 * or invents jobs. Several of these tests currently fail, demonstrating known defects
 * in the script. They should all pass once the script is fixed.
 */

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;

const PREFIX = 'script-test:vendure-job-queue:';

interface SeedJob {
    id: string;
    queueName: string;
    state: 'wait' | 'active' | 'paused' | 'completed' | 'failed' | 'delayed' | 'prioritized';
    createdAt: number;
    settledAt?: number;
    /** For delayed jobs: the time at which the job becomes due */
    delayUntil?: number;
    /** For prioritized jobs: lower value means higher priority */
    priority?: number;
}

const LIST_STATES = ['wait', 'active', 'paused'];

describe('getJobsByType Lua script', () => {
    const redis = new Redis({ host: redisHost, port: redisPort, maxRetriesPerRequest: null });
    redis.defineCommand(getJobsByType.name, {
        numberOfKeys: getJobsByType.numberOfKeys,
        lua: getJobsByType.script,
    });

    function callScript(
        skip: number,
        take: number,
        filterName: string,
        states: string[] = ALL_JOB_TYPES,
    ): Promise<[number, string[]]> {
        const names = filterName ? [filterName] : [];
        return (redis as any).getJobsByType(PREFIX, skip, take, names.length, ...names, ...states);
    }

    async function deleteTestKeys() {
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'script-test:*', 'COUNT', 1000);
            cursor = nextCursor;
            if (keys.length) {
                await redis.del(...keys);
            }
        } while (cursor !== '0');
    }

    /**
     * Seeds jobs into all the Redis structures that BullMQ and the JobListIndexService
     * maintain in a real system, so that the script under test (and any future
     * implementation) finds a faithful data layout.
     */
    async function seedJobs(jobs: SeedJob[]) {
        const pipeline = redis.pipeline();
        // Native list structures must be LPUSHed oldest-first so the newest id ends
        // up at the head, matching how BullMQ adds jobs.
        for (const listState of LIST_STATES) {
            const listJobs = jobs
                .filter(j => j.state === listState)
                .sort((a, b) => a.createdAt - b.createdAt);
            for (const job of listJobs) {
                pipeline.lpush(`${PREFIX}${listState}`, job.id);
            }
        }
        let prioritizedCounter = 0;
        for (const job of jobs) {
            pipeline.hset(`${PREFIX}${job.id}`, {
                name: job.queueName,
                timestamp: job.createdAt.toString(),
            });
            pipeline.sadd(`${PREFIX}queue-names`, job.queueName);
            pipeline.zadd(`${PREFIX}queue:${job.queueName}:${job.state}`, job.createdAt, job.id);
            if (job.state === 'completed' || job.state === 'failed') {
                pipeline.zadd(`${PREFIX}${job.state}`, job.settledAt ?? job.createdAt, job.id);
            }
            if (job.state === 'delayed') {
                // BullMQ encodes the delayed timestamp as `ms * 0x1000 + count`
                pipeline.zadd(`${PREFIX}delayed`, (job.delayUntil ?? job.createdAt) * 4096, job.id);
            }
            if (job.state === 'prioritized') {
                // BullMQ scores the prioritized set as `priority * 2^32 + counter`,
                // which has no relationship to creation time
                const score = (job.priority ?? 10) * 2 ** 32 + prioritizedCounter++;
                pipeline.zadd(`${PREFIX}prioritized`, score, job.id);
            }
        }
        await pipeline.exec();
    }

    function makeJobs(
        count: number,
        state: SeedJob['state'],
        queueName: string,
        idPrefix: string,
        firstCreatedAt: number,
    ): SeedJob[] {
        return Array.from({ length: count }, (_, i) => ({
            id: `${idPrefix}${i + 1}`,
            queueName,
            state,
            createdAt: firstCreatedAt + i * 10,
            settledAt: firstCreatedAt + i * 10 + 5,
        }));
    }

    /** Pages through the full result set and returns all collected ids plus page sizes. */
    async function collectAllPages(take: number, filterName: string) {
        const [total] = await callScript(0, take, filterName);
        const allIds: string[] = [];
        const pageSizes: number[] = [];
        for (let skip = 0; skip < total; skip += take) {
            const [, ids] = await callScript(skip, take, filterName);
            allIds.push(...ids);
            pageSizes.push(ids.length);
        }
        return { total, allIds, pageSizes };
    }

    const NOW = 1_700_000_000_000;

    beforeEach(async () => {
        await deleteTestKeys();
    });

    afterAll(async () => {
        await deleteTestKeys();
        await redis.quit();
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('paginates correctly when filtering by queue name (baseline)', async () => {
        // The name-filtered path reads only the indexed sorted sets, so it is not
        // affected by the mixed list/zset defects. This test establishes that the
        // suite's expectations are calibrated correctly.
        const emailJobs = [
            ...makeJobs(25, 'completed', 'email-queue', 'email-completed-', NOW),
            ...makeJobs(5, 'failed', 'email-queue', 'email-failed-', NOW + 10_000),
        ];
        const otherJobs = makeJobs(10, 'completed', 'other-queue', 'other-', NOW + 20_000);
        await seedJobs([...emailJobs, ...otherJobs]);

        const { total, allIds, pageSizes } = await collectAllPages(10, 'email-queue');

        expect(total).toBe(30);
        expect(allIds).toHaveLength(30);
        expect(new Set(allIds).size).toBe(30);
        expect(pageSizes).toEqual([10, 10, 10]);
        expect(allIds.sort()).toEqual(emailJobs.map(j => j.id).sort());
    });

    it('never drops jobs at page boundaries when states span lists and sorted sets', async () => {
        // 5 jobs in the `wait` list + 30 in the `completed` sorted set. Paging through
        // with take=10 must yield every job exactly once and full pages until the
        // final one. The current implementation applies `skip` to the merged sorted-set
        // results AND again to the concatenated list+zset results, silently dropping
        // jobs from every page after the first.
        const completed = makeJobs(30, 'completed', 'default', 'completed-', NOW);
        const waiting = makeJobs(5, 'wait', 'default', 'wait-', NOW + 10_000);
        await seedJobs([...completed, ...waiting]);

        const { total, allIds, pageSizes } = await collectAllPages(10, '');

        expect(total).toBe(35);
        expect(pageSizes).toEqual([10, 10, 10, 5]);
        expect(new Set(allIds).size).toBe(35);
        expect(allIds.sort()).toEqual([...completed, ...waiting].map(j => j.id).sort());
    });

    it('orders jobs newest-first by creation time across list and sorted-set states', async () => {
        // The completed jobs here are newer than the waiting ones, so they must come
        // first. The current implementation always emits list-stored jobs (wait/active)
        // before sorted-set-stored jobs, regardless of when they were created.
        const waiting = makeJobs(3, 'wait', 'default', 'old-wait-', NOW);
        const completed = makeJobs(6, 'completed', 'default', 'new-completed-', NOW + 60_000);
        await seedJobs([...waiting, ...completed]);

        const [total, ids] = await callScript(0, 20, '');

        expect(total).toBe(9);
        const expectedNewestFirst = [...completed, ...waiting]
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(j => j.id);
        expect(ids).toEqual(expectedNewestFirst);
    });

    it('does not let the encoded scores of delayed jobs dominate the ordering', async () => {
        // BullMQ stores delayed jobs with a score of `dueTimestamp * 4096 + n`, which is
        // several orders of magnitude larger than a plain ms timestamp. The current
        // implementation merges these raw scores with the completed/failed timestamps,
        // so a delayed job always sorts above everything else even if it is the oldest.
        const delayed: SeedJob[] = [
            {
                id: 'delayed-1',
                queueName: 'default',
                state: 'delayed',
                createdAt: NOW,
                delayUntil: NOW + 300_000,
            },
        ];
        const completed = makeJobs(3, 'completed', 'default', 'completed-', NOW + 60_000);
        await seedJobs([...delayed, ...completed]);

        const [total, ids] = await callScript(0, 10, '');

        expect(total).toBe(4);
        // The delayed job is the oldest, so it must come last, not first.
        expect(ids[ids.length - 1]).toBe('delayed-1');
        expect(ids.slice(0, 3)).toEqual(['completed-3', 'completed-2', 'completed-1']);
    });

    it('does not count repeatable-job config entries as jobs', async () => {
        // The `repeat` key holds repeatable-job definitions, not job ids. Because
        // ALL_JOB_TYPES includes 'repeat', the current implementation counts these
        // entries in the total and can return the raw config keys as if they were
        // job ids.
        const completed = makeJobs(5, 'completed', 'default', 'completed-', NOW);
        await seedJobs(completed);
        await redis.zadd(
            `${PREFIX}repeat`,
            NOW,
            'aabbcc112233:::*/5 * * * *',
            NOW + 1,
            'ddeeff445566:::0 0 * * *',
            NOW + 2,
            '112233aabbcc:::0 12 * * MON',
        );

        const [total, ids] = await callScript(0, 10, '');

        expect(total).toBe(5);
        const realIds = completed.map(j => j.id);
        for (const id of ids) {
            expect(realIds).toContain(id);
        }
    });

    it('does not omit jobs when a state is larger than the page and natively ordered by priority', async () => {
        // BullMQ's native prioritized set is scored by `priority * 2^32 + counter`,
        // which has no relationship to creation time. If page candidates were
        // selected from the native structure by its own ordering, the newest jobs
        // (added here with the best priorities, so sorted last by ZREVRANGE) would
        // be cut before the creation-time sort could consider them.
        const prioritized: SeedJob[] = Array.from({ length: 30 }, (_, i) => ({
            id: `prio-${i + 1}`,
            queueName: 'default',
            state: 'prioritized' as const,
            createdAt: NOW + i * 10,
            // The newest jobs get the numerically lowest (i.e. best) priority
            priority: 30 - i,
        }));
        const completed = makeJobs(5, 'completed', 'default', 'completed-', NOW - 60_000);
        await seedJobs([...prioritized, ...completed]);

        const [total, ids] = await callScript(0, 10, '');

        expect(total).toBe(35);
        // Page 1 must hold the 10 newest jobs by creation time: prio-30 .. prio-21
        expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => `prio-${30 - i}`));
    });

    it('returns the total without fetching jobs when take is zero', async () => {
        // A zero (or negative) page size must not translate into a full-range
        // Redis read: a range end of `skip + take - 1 = -1` would mean "the whole
        // structure" to Redis.
        const completed = makeJobs(20, 'completed', 'default', 'completed-', NOW);
        await seedJobs(completed);

        const [total, ids] = await callScript(0, 0, '');

        expect(total).toBe(20);
        expect(ids).toEqual([]);
    });

    it('handles more than 8000 waiting jobs without erroring', async () => {
        // Lua's unpack() is limited to roughly 8000 arguments. The current
        // implementation calls `RPUSH tempKey unpack(listElements)` with the entire
        // wait list, so the query throws once the queue backlog exceeds that limit.
        const completed = makeJobs(10, 'completed', 'default', 'completed-', NOW);
        await seedJobs(completed);
        const waitCount = 9000;
        const chunkSize = 1000;
        for (let i = 0; i < waitCount; i += chunkSize) {
            const pipeline = redis.pipeline();
            for (let j = i; j < Math.min(i + chunkSize, waitCount); j++) {
                const id = `bulk-wait-${j + 1}`;
                const createdAt = NOW + 100_000 + j;
                pipeline.lpush(`${PREFIX}wait`, id);
                pipeline.hset(`${PREFIX}${id}`, { name: 'default', timestamp: createdAt.toString() });
                pipeline.zadd(`${PREFIX}queue:default:wait`, createdAt, id);
            }
            await pipeline.exec();
        }

        const [total, ids] = await callScript(0, 10, '');

        expect(total).toBe(9010);
        expect(ids).toHaveLength(10);
    });
});
