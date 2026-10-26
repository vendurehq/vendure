import { ProcessContext } from '@vendure/core';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobListIndexService } from '../src/bullmq/job-list-index.service';

const PREFIX = 'job-index-migration-test';
const connection = {
    host: '127.0.0.1',
    port: process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379,
    maxRetriesPerRequest: null,
};

describe('JobListIndexService startup migration', () => {
    const redis = new Redis(connection);
    const queue = new Queue('vendure-job-queue', { connection, prefix: PREFIX });
    const service = new JobListIndexService({ workerOptions: { prefix: PREFIX } }, {
        isServer: false,
    } as ProcessContext);
    Object.assign(service, { redis, queue });

    async function clearTestKeys() {
        const keys = await redis.keys(`${PREFIX}:*`);
        if (keys.length > 0) {
            await redis.del(...keys);
        }
    }

    beforeEach(clearTestKeys);
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
        await queue.close();
        await clearTestKeys();
        await redis.quit();
    });

    // #5296: indexing needs metadata, never the retained job payloads.
    it('merges retained metadata in bounded reads without deserializing job data', async () => {
        const pipeline = redis.pipeline();
        for (let i = 0; i < 205; i++) {
            pipeline.hset(queue.toKey(String(i)), {
                name: i % 2 === 0 ? 'search' : 'email',
                timestamp: String(i),
                data: 'must not be parsed as JSON',
                returnvalue: 'must not be parsed as JSON',
            });
            pipeline.zadd(queue.toKey('completed'), i, String(i));
        }
        // A job can disappear between reading the IDs and fetching its metadata.
        pipeline.zadd(queue.toKey('completed'), 205, 'deleted');
        pipeline.hset(queue.toKey('invalid'), { name: 'invalid', timestamp: 'not-a-number' });
        pipeline.zadd(queue.toKey('completed'), 206, 'invalid');
        pipeline.hset(queue.toKey('incomplete'), { name: 'incomplete' });
        pipeline.zadd(queue.toKey('completed'), 207, 'incomplete');
        pipeline.hset(queue.toKey('failed-job'), { name: 'search', timestamp: '42' });
        pipeline.zadd(queue.toKey('failed'), 42, 'failed-job');
        pipeline.zadd(queue.toKey('queue:search:completed'), 0, '0');
        await pipeline.exec();

        const getJobs = vi.spyOn(queue, 'getJobs');
        const readMetadata = redis.hmget.bind(redis);
        let pending = 0;
        let maxPending = 0;
        const hmget = vi.spyOn(redis, 'hmget').mockImplementation((key, ...fields) => {
            pending++;
            maxPending = Math.max(maxPending, pending);
            return readMetadata(key, ...fields).finally(() => pending--);
        });

        await service.migrateExistingJobs();

        expect(getJobs).not.toHaveBeenCalled();
        expect(hmget).toHaveBeenCalledTimes(209);
        expect(maxPending).toBeLessThanOrEqual(100);
        expect(hmget.mock.calls.every(args => args[1] === 'name' && args[2] === 'timestamp')).toBe(true);
        for (const name of ['search', 'email']) {
            const expected = Array.from({ length: 205 }, (_, i) => i)
                .filter(i => (i % 2 === 0 ? 'search' : 'email') === name)
                .flatMap(i => [String(i), String(i)]);
            expect(await redis.zrange(queue.toKey(`queue:${name}:completed`), 0, -1, 'WITHSCORES')).toEqual(
                expected,
            );
        }
        expect(await redis.zrange(queue.toKey('queue:search:failed'), 0, -1, 'WITHSCORES')).toEqual([
            'failed-job',
            '42',
        ]);
        expect((await redis.smembers(queue.toKey('queue-names'))).sort()).toEqual(['email', 'search']);

        await service.migrateExistingJobs();
        expect(await redis.zcard(queue.toKey('queue:search:completed'))).toBe(103);
    });
});
