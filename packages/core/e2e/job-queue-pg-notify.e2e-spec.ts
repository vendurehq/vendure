import { OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    DefaultJobQueuePlugin,
    Injector,
    Job,
    JobQueue,
    JobQueueService,
    mergeConfig,
    PgNotifyJobQueueStrategy,
    PluginCommonModule,
    RequestContextService,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { Client } from 'pg';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { pollUntil } from './utils/poll-until';

const POLL_INTERVAL = 2000;
const RETRY_BACKOFF = 3000;
const QUEUE_NAME = 'pg-notify-test';

type TestJobData = { id: string; failOnce?: boolean };

@VendurePlugin({ imports: [PluginCommonModule] })
class PgNotifyTestPlugin implements OnModuleInit {
    static queue: JobQueue<TestJobData>;
    /** Job id -> the time of each attempt. */
    static attempts = new Map<string, number[]>();
    /** Job id -> the worker which made each attempt. */
    static workers = new Map<string, string[]>();

    constructor(private jobQueueService: JobQueueService) {}

    static process(job: Job<TestJobData>, worker: string): Promise<void> {
        const attempts = PgNotifyTestPlugin.attempts.get(job.data.id) ?? [];
        attempts.push(Date.now());
        PgNotifyTestPlugin.attempts.set(job.data.id, attempts);
        PgNotifyTestPlugin.workers.set(job.data.id, [
            ...(PgNotifyTestPlugin.workers.get(job.data.id) ?? []),
            worker,
        ]);
        if (job.data.failOnce && attempts.length === 1) {
            return Promise.reject(new Error('fail once'));
        }
        return Promise.resolve();
    }

    async onModuleInit() {
        PgNotifyTestPlugin.queue = await this.jobQueueService.createQueue({
            name: QUEUE_NAME,
            process: job => PgNotifyTestPlugin.process(job, 'server'),
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

    /** Adds five jobs one at a time, and returns how long each took to start. */
    async function measurePickups(prefix: string) {
        const latencies: number[] = [];
        for (let i = 0; i < 5; i++) {
            const id = `${prefix}-${i}`;
            const addedAt = Date.now();
            await PgNotifyTestPlugin.queue.add({ id });
            const [startedAt] = await waitForAttempts(id, 1, 5_000);
            latencies.push(startedAt - addedAt);
            // Longer than pollInterval, so the queue is parked again before the next job.
            await sleep(POLL_INTERVAL * 1.5);
        }
        return latencies;
    }

    async function listenerPids(): Promise<number[]> {
        const rows: Array<{ pid: number }> = await server.app
            .get(TransactionalConnection)
            .rawConnection.query(
                `SELECT pid FROM pg_stat_activity
                 WHERE datname = current_database() AND query LIKE 'LISTEN%' AND pid <> pg_backend_pid()`,
            );
        return rows.map(row => row.pid);
    }

    it('picks up each job on notification rather than at the next poll', async () => {
        const latencies = await measurePickups('notify');

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
        const { host, port, username, password, database } = connection.rawConnection
            .options as PostgresConnectionOptions;
        const observer = new Client({ host, port, user: username, password: password as string, database });
        const notified: string[] = [];
        observer.on('notification', message => notified.push(message.payload ?? ''));
        await observer.connect();
        await observer.query('LISTEN vendure_job');

        try {
            await connection
                .withTransaction(ctx, async txCtx => {
                    await PgNotifyTestPlugin.queue.add({ id: 'rolled-back' }, { ctx: txCtx });
                    throw new Error('roll back');
                })
                .catch(() => undefined);
            await sleep(300);
            expect(notified).not.toContain('pg-notify-test');

            const addedAt = Date.now();
            await connection.withTransaction(ctx, txCtx =>
                PgNotifyTestPlugin.queue.add({ id: 'committed' }, { ctx: txCtx }),
            );

            const [startedAt] = await waitForAttempts('committed', 1, 5_000);
            expect(startedAt - addedAt).toBeLessThan(700);
            expect(notified).toContain('pg-notify-test');
        } finally {
            await observer.end();
        }
    });

    it('polls while the listener is down, then reconnects and picks up jobs on notification again', async () => {
        await sleep(POLL_INTERVAL * 1.5);
        const [lostPid] = await listenerPids();
        expect(lostPid).toBeDefined();

        await server.app
            .get(TransactionalConnection)
            .rawConnection.query('SELECT pg_terminate_backend($1)', [lostPid]);
        const addedAt = Date.now();
        await PgNotifyTestPlugin.queue.add({ id: 'while-disconnected' });

        // Nothing is listening, so this job is found by polling.
        const [startedAt] = await waitForAttempts('while-disconnected', 1, POLL_INTERVAL * 3);
        expect(startedAt - addedAt).toBeLessThan(POLL_INTERVAL + 1_000);

        // The first reconnect is scheduled 1s after the loss, and the probe takes one round trip.
        await pollUntil(async () => (await listenerPids()).some(pid => pid !== lostPid), {
            timeout: 10_000,
            interval: 100,
        });
        // Queues poll until their next() sees the new listener, then park.
        await sleep(POLL_INTERVAL * 1.5);

        const latencies = await measurePickups('reconnected');
        expect(Math.max(...latencies)).toBeLessThan(700);
    }, 40_000);

    it('gives each notified job to exactly one of two workers', async () => {
        const second = new PgNotifyJobQueueStrategy({
            pollInterval: POLL_INTERVAL,
            gracefulShutdownTimeout: 1_000,
        });
        const processSecond = (job: Job<TestJobData>) => PgNotifyTestPlugin.process(job, 'second');
        second.init(new Injector(server.app.get(ModuleRef)));
        await second.start(QUEUE_NAME, processSecond);
        try {
            // The second worker connects its listener on its first next(), and parks from the next poll.
            await pollUntil(async () => (await listenerPids()).length === 2, {
                timeout: 10_000,
                interval: 100,
            });
            await sleep(POLL_INTERVAL * 1.5);

            // Both workers wake on each notification. The one which loses the job parks again.
            const latencies = await measurePickups('race');
            expect(Math.max(...latencies)).toBeLessThan(700);

            const burst = Array.from({ length: 6 }, (_, i) => `burst-${i}`);
            await Promise.all(burst.map(id => PgNotifyTestPlugin.queue.add({ id })));
            // After each job, a worker with concurrency 1 waits pollInterval before its next
            // query, so the two workers take three rounds.
            await pollUntil(() => burst.every(id => PgNotifyTestPlugin.attempts.get(id)?.length), {
                timeout: POLL_INTERVAL * 5,
            });
            // Give a second claim on any job time to show up.
            await sleep(500);

            const raced = [...burst, ...Array.from({ length: 5 }, (_, i) => `race-${i}`)];
            for (const id of raced) {
                expect(PgNotifyTestPlugin.workers.get(id), id).toHaveLength(1);
            }
        } finally {
            await second.stop(QUEUE_NAME, processSecond);
            second.destroy();
        }
    }, 60_000);
});

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
