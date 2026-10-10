import { Injector } from '@vendure/core';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BullMQJobQueueStrategy } from '../src/bullmq/bullmq-job-queue-strategy';
import { BULLMQ_PLUGIN_OPTIONS } from '../src/bullmq/constants';
import { JobListIndexService } from '../src/bullmq/job-list-index.service';
import { RedisHealthIndicator } from '../src/bullmq/redis-health-indicator';

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const PREFIX = 'destroy-e2e';
const CONNECTION_NAME = 'destroy-e2e-connection';

async function createStrategy() {
    const providers = new Map<unknown, unknown>([
        [
            BULLMQ_PLUGIN_OPTIONS,
            {
                connection: {
                    host: redisHost,
                    port: redisPort,
                    maxRetriesPerRequest: null,
                    connectionName: CONNECTION_NAME,
                },
                workerOptions: { prefix: PREFIX },
                queueOptions: { prefix: PREFIX },
            },
        ],
        [JobListIndexService, { register: () => undefined, close: () => Promise.resolve() }],
        [RedisHealthIndicator, { isHealthy: () => Promise.resolve({ redis: { status: 'up' } }) }],
    ]);
    const strategy = new BullMQJobQueueStrategy();
    await strategy.init({ get: (token: unknown) => providers.get(token) } as unknown as Injector);
    return strategy;
}

describe('BullMQJobQueueStrategy destroy', () => {
    let redis: Redis;

    async function openConnections() {
        const clients = (await redis.client('LIST')) as string;
        return clients.split('\n').filter(line => line.includes(`name=${CONNECTION_NAME}`)).length;
    }

    async function deleteTestKeys() {
        const keys = await redis.keys(`${PREFIX}:*`);
        if (keys.length) {
            await redis.del(...keys);
        }
    }

    beforeAll(async () => {
        redis = new Redis({ host: redisHost, port: redisPort });
        await deleteTestKeys();
    });

    afterAll(async () => {
        await deleteTestKeys();
        await redis.quit();
    });

    it('closes the Redis connections it opened', async () => {
        const strategy = await createStrategy();
        await strategy.start('destroy-test', () => Promise.resolve());
        expect(await openConnections()).toBeGreaterThan(0);

        await strategy.destroy();

        await vi.waitFor(async () => expect(await openConnections()).toBe(0));
    });
});
