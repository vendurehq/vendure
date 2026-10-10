import { JobState } from '@vendure/common/lib/generated-types';
import { Injector, Job } from '@vendure/core';
import Redis from 'ioredis';
import { firstValueFrom, Subject } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BullMQJobQueueStrategy } from '../src/bullmq/bullmq-job-queue-strategy';
import { BULLMQ_PLUGIN_OPTIONS } from '../src/bullmq/constants';
import { JobListIndexService } from '../src/bullmq/job-list-index.service';
import { RedisHealthIndicator } from '../src/bullmq/redis-health-indicator';

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const PREFIX_A = 'cancel-e2e-a';
const PREFIX_B = 'cancel-e2e-b';
const PREFIX_C = 'cancel-e2e-c';
const QUEUE = 'cancel-test';

async function createStrategy(prefix: string) {
    const providers = new Map<unknown, unknown>([
        [
            BULLMQ_PLUGIN_OPTIONS,
            {
                connection: { host: redisHost, port: redisPort, maxRetriesPerRequest: null },
                workerOptions: { prefix },
                queueOptions: { prefix },
            },
        ],
        [JobListIndexService, { register: () => undefined, close: () => Promise.resolve() }],
        [RedisHealthIndicator, { isHealthy: () => Promise.resolve({ redis: { status: 'up' } }) }],
    ]);
    const strategy = new BullMQJobQueueStrategy();
    await strategy.init({ get: (token: unknown) => providers.get(token) } as unknown as Injector);
    return strategy;
}

describe('BullMQJobQueueStrategy cancellation', () => {
    const release$ = new Subject<void>();
    const running: Record<string, Job> = {};
    const strategies: BullMQJobQueueStrategy[] = [];
    let redis: Redis;

    async function deleteTestKeys() {
        for (const prefix of [PREFIX_A, PREFIX_B, PREFIX_C]) {
            const keys = await redis.keys(`${prefix}:*`);
            if (keys.length) {
                await redis.del(...keys);
            }
        }
    }

    async function startBlockingQueue(prefix: string, name: string) {
        const strategy = await createStrategy(prefix);
        strategies.push(strategy);
        await strategy.start(QUEUE, async job => {
            running[name] = job;
            await firstValueFrom(release$);
        });
        return strategy;
    }

    beforeAll(async () => {
        redis = new Redis({ host: redisHost, port: redisPort });
        await deleteTestKeys();
    });

    afterAll(async () => {
        release$.next();
        await Promise.all(strategies.map(s => s.destroy()));
        await deleteTestKeys();
        await redis.quit();
    });

    it('does not cancel a running job with the same id under a different prefix', async () => {
        const strategyA = await startBlockingQueue(PREFIX_A, 'a');
        const strategyB = await startBlockingQueue(PREFIX_B, 'b');

        const jobA = await strategyA.add(new Job({ queueName: QUEUE, data: {} }));
        const jobB = await strategyB.add(new Job({ queueName: QUEUE, data: {} }));
        expect(jobA.id).toBe(jobB.id);

        await vi.waitFor(() => {
            expect(running.a).toBeDefined();
            expect(running.b).toBeDefined();
        });

        await strategyA.cancelJob(jobA.id as string);
        await vi.waitFor(() => expect(running.a.state).toBe(JobState.CANCELLED));
        await new Promise(resolve => setTimeout(resolve, 300));

        expect(running.b.state).toBe(JobState.RUNNING);
        expect((await strategyB.findOne(jobB.id as string))?.state).toBe(JobState.RUNNING);
    });

    it('cancels a running job from another instance that shares the prefix', async () => {
        const worker = await startBlockingQueue(PREFIX_C, 'c');
        const other = await createStrategy(PREFIX_C);
        strategies.push(other);

        const job = await other.add(new Job({ queueName: QUEUE, data: {} }));
        await vi.waitFor(() => expect(running.c).toBeDefined());

        await other.cancelJob(job.id as string);

        await vi.waitFor(() => expect(running.c.state).toBe(JobState.CANCELLED));
        expect((await worker.findOne(job.id as string))?.state).toBe(JobState.CANCELLED);
    });
});
