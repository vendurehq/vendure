import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../api/common/request-context';
import { TRANSACTION_NO_RETRY_KEY } from '../common/constants';
import { ConfigService } from '../config/config.service';

import { TransactionSubscriber } from './transaction-subscriber';
import { TransactionWrapper } from './transaction-wrapper';

/**
 * A minimal stand-in for a TypeORM QueryRunner which records the transaction lifecycle, so a test
 * can assert that a retry actually rolled back and started a fresh transaction.
 */
function mockQueryRunner() {
    const calls: string[] = [];
    return {
        calls,
        isReleased: false,
        isTransactionActive: false,
        manager: {},
        data: {} as Record<symbol, unknown>,
        query: vi.fn(async (sql: string) => {
            calls.push(sql);
        }),
        startTransaction: vi.fn(async function (this: any) {
            calls.push('start');
            runner.isTransactionActive = true;
        }),
        commitTransaction: vi.fn(async () => {
            calls.push('commit');
            runner.isTransactionActive = false;
        }),
        rollbackTransaction: vi.fn(async () => {
            calls.push('rollback');
            runner.isTransactionActive = false;
        }),
        release: vi.fn(async () => {
            calls.push('release');
            runner.isReleased = true;
        }),
    } as any;
}

let runner: any;

function mockConnection(type = 'postgres', isolationLevel?: string) {
    runner = mockQueryRunner();
    // Lets a nested executeInTransaction() inherit the runner, as TypeORM's manager would.
    runner.manager.queryRunner = runner;
    return { createQueryRunner: () => runner, options: { type, isolationLevel } } as any;
}

let transactionSubscriber: { announceRollback: ReturnType<typeof vi.fn> };

function wrapper(entityOptions: Record<string, unknown> = {}) {
    transactionSubscriber = { announceRollback: vi.fn() };
    return new TransactionWrapper(
        { entityOptions } as unknown as ConfigService,
        transactionSubscriber as unknown as TransactionSubscriber,
    );
}

function deadlock() {
    const err: any = new Error('deadlock detected');
    err.code = '40P01';
    return err;
}

describe('TransactionWrapper', () => {
    const ctx = RequestContext.empty();

    it('commits when the work succeeds', async () => {
        const connection = mockConnection();
        const result = await wrapper().executeInTransaction(
            ctx,
            async () => 'done',
            'auto',
            undefined,
            connection,
        );

        expect(result).toBe('done');
        expect(runner.calls).toEqual(['start', 'commit', 'release']);
    });

    it('rolls back and starts a new transaction before retrying a deadlock', async () => {
        const connection = mockConnection();
        let attempts = 0;
        const result = await wrapper().executeInTransaction(
            ctx,
            async () => {
                attempts++;
                if (attempts === 1) {
                    throw deadlock();
                }
                return 'done';
            },
            'auto',
            undefined,
            connection,
        );

        expect(result).toBe('done');
        expect(attempts).toBe(2);
        // The retry must not run on the transaction the database has already aborted.
        expect(runner.calls).toEqual(['start', 'rollback', 'start', 'commit', 'release']);
    });

    it('throws the original error once the retry budget is spent', async () => {
        const connection = mockConnection();
        let attempts = 0;
        await expect(
            wrapper().executeInTransaction(
                ctx,
                async () => {
                    attempts++;
                    throw deadlock();
                },
                'auto',
                undefined,
                connection,
            ),
        ).rejects.toThrow('deadlock detected');

        // The initial attempt plus five retries.
        expect(attempts).toBe(6);
    });

    it('does not retry an error which is not retriable', async () => {
        const connection = mockConnection();
        let attempts = 0;
        await expect(
            wrapper().executeInTransaction(
                ctx,
                async () => {
                    attempts++;
                    throw new Error('bad input');
                },
                'auto',
                undefined,
                connection,
            ),
        ).rejects.toThrow('bad input');

        expect(attempts).toBe(1);
        expect(runner.calls).toEqual(['start', 'rollback', 'release']);
    });

    it('keeps the mark when a nested transaction runs after it', async () => {
        const connection = mockConnection();
        const w = wrapper();
        let attempts = 0;
        await expect(
            w.executeInTransaction(
                ctx,
                async innerCtx => {
                    attempts++;
                    // What PaymentService.createPayment() does: mark, call the provider, then
                    // record the payment in a nested transaction.
                    runner.data[TRANSACTION_NO_RETRY_KEY] = true;
                    await w.executeInTransaction(
                        innerCtx,
                        async () => 'saved',
                        'auto',
                        undefined,
                        connection,
                    );
                    throw deadlock();
                },
                'auto',
                undefined,
                connection,
            ),
        ).rejects.toThrow('deadlock detected');

        expect(attempts).toBe(1);
    });

    it('gives each attempt a fresh copy of the context', async () => {
        const connection = mockConnection();
        const seen: RequestContext[] = [];
        await wrapper().executeInTransaction(
            ctx,
            async attemptCtx => {
                seen.push(attemptCtx);
                if (seen.length === 1) {
                    throw deadlock();
                }
                return 'done';
            },
            'auto',
            undefined,
            connection,
        );

        // Request-scoped caches are keyed on the context, so a retry on the same object would see
        // what the rolled-back attempt had read.
        expect(seen).toHaveLength(2);
        expect(seen[1]).not.toBe(seen[0]);
        expect(seen[1]).not.toBe(ctx);
    });

    it('does not retry an attempt which was marked as unsafe to retry', async () => {
        const connection = mockConnection();
        let attempts = 0;
        await expect(
            wrapper().executeInTransaction(
                ctx,
                async () => {
                    attempts++;
                    // What TransactionalConnection.preventTransactionRetry() does, e.g. before a
                    // payment provider is called.
                    runner.data[TRANSACTION_NO_RETRY_KEY] = true;
                    throw deadlock();
                },
                'auto',
                undefined,
                connection,
            ),
        ).rejects.toThrow('deadlock detected');

        expect(attempts).toBe(1);
    });

    it('does not carry a mark over from an earlier transaction on the same runner', async () => {
        // SQLite drivers share one runner between transactions, so a mark set by one must not stop
        // the retry of the next.
        const connection = mockConnection();
        const w = wrapper();
        await w.executeInTransaction(
            ctx,
            async () => {
                runner.data[TRANSACTION_NO_RETRY_KEY] = true;
                return 'charged';
            },
            'auto',
            undefined,
            connection,
        );
        runner.isReleased = false;
        let attempts = 0;
        const result = await w.executeInTransaction(
            ctx,
            async () => {
                attempts++;
                if (attempts === 1) {
                    throw deadlock();
                }
                return 'done';
            },
            'auto',
            undefined,
            connection,
        );

        expect(result).toBe('done');
        expect(attempts).toBe(2);
    });

    it('rethrows the original error and releases the connection when the rollback fails', async () => {
        const connection = mockConnection('mysql');
        runner.rollbackTransaction.mockImplementation(async () => {
            throw new Error('SAVEPOINT typeorm_1 does not exist');
        });
        await expect(
            wrapper().executeInTransaction(
                ctx,
                async () => {
                    throw new Error('bad input');
                },
                'auto',
                undefined,
                connection,
            ),
        ).rejects.toThrow('bad input');

        expect(runner.query).toHaveBeenCalledWith('ROLLBACK');
        expect(transactionSubscriber.announceRollback).toHaveBeenCalledWith(runner);
        expect(runner.release).toHaveBeenCalled();
    });

    describe('isolation level', () => {
        async function startedWith(type: string, requested?: any, configured?: any) {
            const connection = mockConnection(type);
            await wrapper(configured ? { transactionIsolationLevel: configured } : {}).executeInTransaction(
                ctx,
                async () => 'done',
                'auto',
                requested,
                connection,
            );
            return runner.startTransaction.mock.calls[0][0];
        }

        it('defaults to READ COMMITTED on MySQL and MariaDB', async () => {
            expect(await startedWith('mysql')).toBe('READ COMMITTED');
            expect(await startedWith('mariadb')).toBe('READ COMMITTED');
        });

        it('leaves the database default in place elsewhere', async () => {
            expect(await startedWith('postgres')).toBeUndefined();
            expect(await startedWith('sqljs')).toBeUndefined();
        });

        it('uses the configured level over the default', async () => {
            expect(await startedWith('mysql', undefined, 'REPEATABLE READ')).toBe('REPEATABLE READ');
            expect(await startedWith('postgres', undefined, 'SERIALIZABLE')).toBe('SERIALIZABLE');
        });

        it('keeps an isolation level set in dbConnectionOptions', async () => {
            const connection = mockConnection('mysql', 'SERIALIZABLE');
            await wrapper().executeInTransaction(ctx, async () => 'done', 'auto', undefined, connection);
            expect(runner.startTransaction.mock.calls[0][0]).toBe('SERIALIZABLE');
        });

        it('uses an explicitly requested level over the configured one', async () => {
            expect(await startedWith('mysql', 'SERIALIZABLE', 'REPEATABLE READ')).toBe('SERIALIZABLE');
        });
    });
});
