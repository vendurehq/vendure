import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../api/common/request-context';

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

function mockConnection() {
    runner = mockQueryRunner();
    return { createQueryRunner: () => runner } as any;
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
        const result = await new TransactionWrapper().executeInTransaction(
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
        const result = await new TransactionWrapper().executeInTransaction(
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
            new TransactionWrapper().executeInTransaction(
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
            new TransactionWrapper().executeInTransaction(
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
});
