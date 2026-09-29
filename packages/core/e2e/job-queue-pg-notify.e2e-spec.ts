import { OnModuleInit } from '@nestjs/common';
import {
    DefaultJobQueuePlugin,
    JobQueue,
    JobQueueService,
    mergeConfig,
    PluginCommonModule,
    RequestContextService,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const POLL_INTERVAL = 2000;
const RETRY_BACKOFF = 3000;

@VendurePlugin({ imports: [PluginCommonModule] })
class PgNotifyTestPlugin implements OnModuleInit {
    static queue: JobQueue<{ id: string; failOnce?: boolean }>;
    /** Job id -> the time of each attempt. */
    static attempts = new Map<string, number[]>();

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit() {
        PgNotifyTestPlugin.queue = await this.jobQueueService.createQueue({
            name: 'pg-notify-test',
            process: async job => {
                const attempts = PgNotifyTestPlugin.attempts.get(job.data.id) ?? [];
                attempts.push(Date.now());
                PgNotifyTestPlugin.attempts.set(job.data.id, attempts);
                if (job.data.failOnce && attempts.length === 1) {
                    throw new Error('fail once');
                }
            },
        });
    }
}

describe.skipIf(process.env.DB !== 'postgres')('PgNotifyJobQueueStrategy', () => {
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [
                DefaultJobQueuePlugin.init({
                    pollInterval: POLL_INTERVAL,
                    backoffStrategy: () => RETRY_BACKOFF,
                    gracefulShutdownTimeout: 1_000,
                    useNotify: true,
                }),
                PgNotifyTestPlugin,
            ],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        // Queues poll until the listener is connected, so give them one poll to park.
        await sleep(POLL_INTERVAL * 2);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function waitForAttempts(id: string, count: number, timeoutMs: number) {
        const start = Date.now();
        while ((PgNotifyTestPlugin.attempts.get(id)?.length ?? 0) < count && Date.now() - start < timeoutMs) {
            await sleep(10);
        }
        return PgNotifyTestPlugin.attempts.get(id) ?? [];
    }

    it('picks up each job on notification rather than at the next poll', async () => {
        const latencies: number[] = [];
        for (let i = 0; i < 5; i++) {
            const id = `notify-${i}`;
            const addedAt = Date.now();
            await PgNotifyTestPlugin.queue.add({ id });
            const [startedAt] = await waitForAttempts(id, 1, 5_000);
            latencies.push(startedAt - addedAt);
            // Longer than pollInterval, so the queue is parked again before the next job.
            await sleep(POLL_INTERVAL * 1.5);
        }

        // Polling every 2000ms would put all five under 700ms about 0.5% of the time.
        expect(Math.max(...latencies)).toBeLessThan(700);
    }, 30_000);

    it('retries a failed job once its backoff elapses, not at the safety interval', async () => {
        await PgNotifyTestPlugin.queue.add({ id: 'retry', failOnce: true }, { retries: 1 });

        const attempts = await waitForAttempts('retry', 2, RETRY_BACKOFF * 3);

        expect(attempts.length).toBe(2);
        expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(RETRY_BACKOFF);
        expect(attempts[1] - attempts[0]).toBeLessThan(RETRY_BACKOFF + 2_000);
    });

    it('sends the notification only when the enqueuing transaction commits', async () => {
        // Let the queue park again after the previous test's job.
        await sleep(POLL_INTERVAL * 1.5);
        const connection = server.app.get(TransactionalConnection);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        await connection
            .withTransaction(ctx, async txCtx => {
                await PgNotifyTestPlugin.queue.add({ id: 'rolled-back' }, { ctx: txCtx });
                throw new Error('roll back');
            })
            .catch(() => undefined);
        const addedAt = Date.now();
        await connection.withTransaction(ctx, txCtx =>
            PgNotifyTestPlugin.queue.add({ id: 'committed' }, { ctx: txCtx }),
        );

        const [startedAt] = await waitForAttempts('committed', 1, 5_000);
        expect(startedAt - addedAt).toBeLessThan(700);
        expect(PgNotifyTestPlugin.attempts.has('rolled-back')).toBe(false);
    });
});

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
