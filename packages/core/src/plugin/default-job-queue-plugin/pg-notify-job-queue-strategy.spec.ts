import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Job } from '../../job-queue';

import { PgNotifyJobQueueStrategy } from './pg-notify-job-queue-strategy';
import { SqlJobQueueStrategy } from './sql-job-queue-strategy';

/**
 * These cover the behaviour this strategy adds on top of {@link SqlJobQueueStrategy} -
 * when `next()` parks and when it must not - by stubbing the inherited methods. The
 * database interaction itself is the base class's, and is covered by its own tests.
 */
describe('PgNotifyJobQueueStrategy', () => {
    let strategy: PgNotifyJobQueueStrategy;
    let manager: { query: ReturnType<typeof vi.fn> };

    /** An injector which satisfies both `TransactionalConnection` and `ListQueryBuilder`. */
    function mockInjector(databaseType: string) {
        manager = { query: vi.fn().mockResolvedValue(undefined) };
        return {
            get: () => ({
                rawConnection: { options: { type: databaseType }, manager },
                isWorker: true,
            }),
        } as any;
    }

    /** Resolves to `'parked'` if the promise has not settled within `ms`. */
    function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | 'parked'> {
        return Promise.race([
            promise,
            new Promise<'parked'>(resolve => setTimeout(() => resolve('parked'), ms)),
        ]);
    }

    /** Inits on Postgres with a listener which is already connected. */
    function initPostgres() {
        strategy.init(mockInjector('postgres'));
        (strategy as any).listener = { end: () => Promise.resolve() };
    }

    beforeEach(() => {
        strategy = new PgNotifyJobQueueStrategy({ safetyIntervalMs: 60_000 });
        // The listener would otherwise try to reach a real Postgres.
        (strategy as any).connectListener = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
        strategy.destroy();
        vi.restoreAllMocks();
    });

    describe('on a database which cannot notify', () => {
        it('never parks, so the queue falls back to polling rather than stalling', async () => {
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            strategy.init(mockInjector('better-sqlite3'));

            expect(await settledWithin(strategy.next('video'), 50)).toBeUndefined();
        });

        it('does not attempt to notify on add', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'add').mockResolvedValue(job as any);
            strategy.init(mockInjector('mysql'));

            await strategy.add(job);

            expect(manager.query).not.toHaveBeenCalled();
        });
    });

    describe('on Postgres', () => {
        it('returns a waiting job immediately, so a backlog drains at full speed', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(job as any);
            initPostgres();

            expect(await settledWithin(strategy.next('video'), 50)).toBe(job);
        });

        it('parks when the queue is empty instead of asking again', async () => {
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            initPostgres();

            expect(await settledWithin(strategy.next('video'), 50)).toBe('parked');
        });

        it('releases a parked next() on stop, so shutdown is not held up', async () => {
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            vi.spyOn(SqlJobQueueStrategy.prototype, 'stop').mockResolvedValue(undefined);
            initPostgres();

            const pending = strategy.next('video');
            await strategy.stop('video', () => Promise.resolve(undefined));

            expect(await settledWithin(pending, 50)).toBeUndefined();
        });

        it('notifies the queue name so only that queue is woken', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'add').mockResolvedValue(job as any);
            initPostgres();

            await strategy.add(job);

            expect(manager.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', ['vendure_job', 'video']);
        });

        it('never fails the caller when the notification cannot be sent', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'add').mockResolvedValue(job as any);
            initPostgres();
            manager.query.mockRejectedValue(new Error('connection terminated'));

            // The job still starts after the safety interval. The caller's transaction may
            // be an order being placed.
            await expect(strategy.add(job)).resolves.toBe(job);
        });

        it('polls instead of parking while the listener is not connected', async () => {
            const next = vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            strategy.init(mockInjector('postgres'));

            expect(await settledWithin(strategy.next('video'), 50)).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
            expect((strategy as any).connectListener).toHaveBeenCalled();
        });

        it('wakes a parked next() on a notification and returns the job', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next')
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(job as any);
            initPostgres();

            const pending = strategy.next('video');
            await settledWithin(pending, 10);
            (strategy as any).wake('video');

            expect(await settledWithin(pending, 50)).toBe(job);
        });

        it('does not lose a notification which arrives before next() parks', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            let wakeDuringQuery = true;
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockImplementation(async () => {
                if (wakeDuringQuery) {
                    wakeDuringQuery = false;
                    (strategy as any).wake('video');
                    return undefined;
                }
                return job as any;
            });
            initPostgres();

            expect(await settledWithin(strategy.next('video'), 50)).toBe(job);
        });

        it('does not claim a job after being released by stop()', async () => {
            const next = vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            vi.spyOn(SqlJobQueueStrategy.prototype, 'stop').mockResolvedValue(undefined);
            initPostgres();

            const pending = strategy.next('video');
            await settledWithin(pending, 10);
            await strategy.stop('video', () => Promise.resolve(undefined));

            expect(await settledWithin(pending, 50)).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(1);
        });

        it('wakes a parked next() when a retry it scheduled becomes due', async () => {
            strategy = new PgNotifyJobQueueStrategy({ safetyIntervalMs: 60_000, backoffStrategy: () => 100 });
            (strategy as any).connectListener = vi.fn().mockResolvedValue(undefined);
            vi.spyOn(SqlJobQueueStrategy.prototype, 'update').mockResolvedValue(undefined);
            const next = vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            initPostgres();
            const job = new Job({ id: 1, queueName: 'video', data: {}, retries: 1 });
            job.start();
            job.fail(new Error('boom'));
            expect(job.state).toBe('RETRYING');

            await strategy.update(job);
            const pending = strategy.next('video');

            expect(await settledWithin(pending, 50)).toBe('parked');
            expect(await settledWithin(pending, 200)).toBeUndefined();
            expect(next).toHaveBeenCalledTimes(2);
        });

        it('releases an already-parked next() when a retry is recorded, so it re-parks with the shorter timeout', async () => {
            strategy = new PgNotifyJobQueueStrategy({ safetyIntervalMs: 60_000, backoffStrategy: () => 100 });
            (strategy as any).connectListener = vi.fn().mockResolvedValue(undefined);
            vi.spyOn(SqlJobQueueStrategy.prototype, 'update').mockResolvedValue(undefined);
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            initPostgres();
            const pending = strategy.next('video');
            expect(await settledWithin(pending, 20)).toBe('parked');

            // Another concurrency slot's job fails while this one is parked.
            const job = new Job({ id: 1, queueName: 'video', data: {}, retries: 1 });
            job.start();
            job.fail(new Error('boom'));
            await strategy.update(job);

            expect(await settledWithin(pending, 20)).toBeUndefined();
        });

        it('builds the listener config from replication master and extra, like TypeORM', () => {
            initPostgres();
            (strategy as any).dataSource.options = {
                type: 'postgres',
                host: 'ignored',
                replication: {
                    master: { host: 'primary', port: 5433, username: 'u', password: 'p', database: 'd' },
                },
                extra: { ssl: { rejectUnauthorized: false }, max: 10 },
            };

            expect((strategy as any).clientConfig()).toMatchObject({
                host: 'primary',
                port: 5433,
                user: 'u',
                password: 'p',
                database: 'd',
                ssl: { rejectUnauthorized: false },
                keepAlive: true,
            });
        });

        it('lets extra override the listener keepalive', () => {
            initPostgres();
            (strategy as any).dataSource.options = { type: 'postgres', extra: { keepAlive: false } };

            expect((strategy as any).clientConfig().keepAlive).toBe(false);
        });

        it('notifies when a deferred job goes back to PENDING, so other workers pick it up', async () => {
            vi.spyOn(SqlJobQueueStrategy.prototype, 'update').mockResolvedValue(undefined);
            initPostgres();
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            job.start();
            job.defer();

            await strategy.update(job);

            expect(manager.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', ['vendure_job', 'video']);
        });

        it('accepts a listener which receives its own probe', async () => {
            initPostgres();
            const client = new EventEmitter();
            manager.query.mockImplementation((_sql: string, [channel, payload]: string[]) => {
                client.emit('notification', { channel, payload });
                return Promise.resolve();
            });

            expect(await (strategy as any).probe(client)).toBe(true);
        });

        it('rejects a listener behind a transaction-mode pooler, which never receives the probe', async () => {
            vi.useFakeTimers();
            initPostgres();

            const result = (strategy as any).probe(new EventEmitter());
            await vi.advanceTimersByTimeAsync(3_000);

            expect(await result).toBe(false);
            vi.useRealTimers();
        });
    });
});
