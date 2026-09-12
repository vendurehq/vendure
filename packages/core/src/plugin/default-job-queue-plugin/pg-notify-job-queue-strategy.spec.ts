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
            strategy.init(mockInjector('postgres'));

            expect(await settledWithin(strategy.next('video'), 50)).toBe(job);
        });

        it('parks when the queue is empty instead of asking again', async () => {
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            strategy.init(mockInjector('postgres'));

            expect(await settledWithin(strategy.next('video'), 50)).toBe('parked');
        });

        it('releases a parked next() on stop, so shutdown is not held up', async () => {
            vi.spyOn(SqlJobQueueStrategy.prototype, 'next').mockResolvedValue(undefined);
            vi.spyOn(SqlJobQueueStrategy.prototype, 'stop').mockResolvedValue(undefined);
            strategy.init(mockInjector('postgres'));

            const pending = strategy.next('video');
            await strategy.stop('video', () => Promise.resolve(undefined));

            expect(await settledWithin(pending, 50)).toBeUndefined();
        });

        it('notifies the queue name so only that queue is woken', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'add').mockResolvedValue(job as any);
            strategy.init(mockInjector('postgres'));

            await strategy.add(job);

            expect(manager.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', ['vendure_job', 'video']);
        });

        it('never fails the caller when the notification cannot be sent', async () => {
            const job = new Job({ id: 1, queueName: 'video', data: {} });
            vi.spyOn(SqlJobQueueStrategy.prototype, 'add').mockResolvedValue(job as any);
            strategy.init(mockInjector('postgres'));
            manager.query.mockRejectedValue(new Error('connection terminated'));

            // A wake-up which fails to send is late work, not lost work. The transaction
            // this rides on may be an order being placed.
            await expect(strategy.add(job)).resolves.toBe(job);
        });
    });
});
