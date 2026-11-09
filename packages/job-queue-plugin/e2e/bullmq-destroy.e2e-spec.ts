import { Injector, Logger, ProcessContext } from '@vendure/core';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { BullMQJobQueueStrategy } from '../src/bullmq/bullmq-job-queue-strategy';
import { BULLMQ_PLUGIN_OPTIONS } from '../src/bullmq/constants';
import { JobListIndexService } from '../src/bullmq/job-list-index.service';
import { RedisHealthIndicator } from '../src/bullmq/redis-health-indicator';
import { RedisJobBufferStorageStrategy } from '../src/bullmq/redis-job-buffer-storage-strategy';
import { BullMQPluginOptions } from '../src/bullmq/types';

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const PREFIX = 'destroy-e2e';
const CONNECTION_NAME = 'destroy-e2e-connection';

async function countConnections(redis: Redis, connectionName: string) {
    const clients = (await redis.client('LIST')) as string;
    return clients.split('\n').filter(line => line.includes(`name=${connectionName} `)).length;
}

async function createStrategy(jobListIndexService?: (options: BullMQPluginOptions) => JobListIndexService) {
    const options: BullMQPluginOptions = {
        connection: {
            host: redisHost,
            port: redisPort,
            maxRetriesPerRequest: null,
            connectionName: CONNECTION_NAME,
        },
        workerOptions: { prefix: PREFIX },
        queueOptions: { prefix: PREFIX },
    };
    const providers = new Map<unknown, unknown>([
        [BULLMQ_PLUGIN_OPTIONS, options],
        [
            JobListIndexService,
            jobListIndexService?.(options) ?? { register: () => undefined, close: () => Promise.resolve() },
        ],
        [RedisHealthIndicator, { isHealthy: () => Promise.resolve({ redis: { status: 'up' } }) }],
    ]);
    const strategy = new BullMQJobQueueStrategy();
    await strategy.init({ get: (token: unknown) => providers.get(token) } as unknown as Injector);
    return strategy;
}

describe('BullMQJobQueueStrategy destroy', () => {
    let redis: Redis;

    function openConnections() {
        return countConnections(redis, CONNECTION_NAME);
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
        // The main connection and the cancellation subscriber
        expect(await openConnections()).toBe(2);

        await strategy.destroy();

        await vi.waitFor(async () => expect(await openConnections()).toBe(0));
    });

    it('lets the job index migration finish before closing the connection', async () => {
        const pipeline = redis.pipeline();
        for (let i = 0; i < 1000; i++) {
            pipeline.hset(`${PREFIX}:vendure-job-queue:${i}`, { name: 'destroy-test', timestamp: String(i) });
            pipeline.zadd(`${PREFIX}:vendure-job-queue:completed`, i, String(i));
        }
        await pipeline.exec();
        const loggerError = vi.spyOn(Logger, 'error');

        // A worker migrates the existing jobs into the index on startup, without awaiting it
        const strategy = await createStrategy(
            options => new JobListIndexService(options, { isServer: false } as ProcessContext),
        );
        await strategy.destroy();
        // Commands which were still pending when the connection closed reject shortly afterwards
        await new Promise(resolve => setTimeout(resolve, 500));

        expect(loggerError).not.toHaveBeenCalled();
        loggerError.mockRestore();
    });
});

describe('RedisJobBufferStorageStrategy destroy', () => {
    let redis: Redis;

    function createBufferStrategy(connection: BullMQPluginOptions['connection']) {
        const options: BullMQPluginOptions = { connection };
        const strategy = new RedisJobBufferStorageStrategy();
        strategy.init({
            get: (token: unknown) => (token === BULLMQ_PLUGIN_OPTIONS ? options : undefined),
        } as unknown as Injector);
        return strategy;
    }

    function connectionOptions(connectionName: string) {
        return { host: redisHost, port: redisPort, maxRetriesPerRequest: null, connectionName };
    }

    beforeAll(() => {
        redis = new Redis({ host: redisHost, port: redisPort });
    });

    afterAll(async () => {
        await redis.quit();
    });

    // #5601
    it('closes the Redis connection it opened', async () => {
        const connectionName = 'buffer-destroy-e2e-owned';
        const strategy = createBufferStrategy(connectionOptions(connectionName));
        await strategy.bufferSize([]);
        await vi.waitFor(async () => expect(await countConnections(redis, connectionName)).toBe(1));

        await strategy.destroy();

        await vi.waitFor(async () => expect(await countConnections(redis, connectionName)).toBe(0));
    });

    it('logs instead of throwing when the connection is already closed', async () => {
        const strategy = createBufferStrategy(connectionOptions('buffer-destroy-e2e-closed'));
        await strategy.bufferSize([]);
        await strategy.destroy();
        const loggerError = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

        try {
            await expect(strategy.destroy()).resolves.toBeUndefined();

            expect(loggerError).toHaveBeenCalledTimes(1);
            expect(loggerError.mock.calls[0][0]).toContain('Error closing Redis connection');
        } finally {
            loggerError.mockRestore();
        }
    });

    it('leaves a connection supplied by the caller open', async () => {
        const connectionName = 'buffer-destroy-e2e-supplied';
        const supplied = new Redis(connectionOptions(connectionName));
        try {
            const strategy = createBufferStrategy(supplied);
            await supplied.ping();

            await strategy.destroy();

            await expect(supplied.ping()).resolves.toBe('PONG');
            expect(await countConnections(redis, connectionName)).toBe(1);
        } finally {
            supplied.disconnect();
        }
    });
});
