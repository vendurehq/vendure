import { Injector } from '@vendure/core';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BullMQJobQueueStrategy } from '../src/bullmq/bullmq-job-queue-strategy';
import { BULLMQ_PLUGIN_OPTIONS } from '../src/bullmq/constants';
import { JobListIndexService } from '../src/bullmq/job-list-index.service';
import { RedisHealthIndicator } from '../src/bullmq/redis-health-indicator';
import { BullMQPluginOptions } from '../src/bullmq/types';

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const PREFIX = 'connection-instance-e2e';
const CONNECTION_NAME = 'connection-instance-e2e-connection';

describe('BullMQJobQueuePlugin with a Redis instance as connection', () => {
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

    it('uses the supplied instance and leaves it open', async () => {
        const supplied = new Redis({
            host: redisHost,
            port: redisPort,
            maxRetriesPerRequest: null,
            connectionName: CONNECTION_NAME,
        });
        const options: BullMQPluginOptions = {
            connection: supplied,
            workerOptions: { prefix: PREFIX },
            queueOptions: { prefix: PREFIX },
        };
        const providers = new Map<unknown, unknown>([
            [BULLMQ_PLUGIN_OPTIONS, options],
            [JobListIndexService, { register: () => undefined, close: () => Promise.resolve() }],
            [RedisHealthIndicator, new RedisHealthIndicator(options)],
        ]);
        const strategy = new BullMQJobQueueStrategy();
        let destroyed = false;
        try {
            await strategy.init({ get: (token: unknown) => providers.get(token) } as unknown as Injector);
            await strategy.start('instance-test', () => Promise.resolve());

            expect(supplied.status).toBe('ready');
            await expect(supplied.ping()).resolves.toBe('PONG');
            // The supplied instance and the cancellation subscriber duplicated from it
            await vi.waitFor(async () => expect(await openConnections()).toBe(2));

            await strategy.destroy();
            destroyed = true;

            expect(supplied.status).toBe('ready');
            await vi.waitFor(async () => expect(await openConnections()).toBe(1));
        } finally {
            // Close everything when an assertion fails part way through
            if (!destroyed) {
                await strategy.destroy().catch(() => undefined);
            }
            supplied.disconnect();
        }
    });
});
