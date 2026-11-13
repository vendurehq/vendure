import {
    LockNotSupportedOnGivenDriverError,
    PessimisticLockTransactionRequiredError,
    SelectQueryBuilder,
} from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { withLockIfSupported } from './with-lock-if-supported';

function fakeQueryBuilder() {
    const locked = { locked: true };
    const qb = {
        clone: () => ({ setLock: vi.fn(() => locked) }),
    } as unknown as SelectQueryBuilder<any>;
    return { qb, locked };
}

describe('withLockIfSupported()', () => {
    it('runs the query as a locking read', async () => {
        const { qb, locked } = fakeQueryBuilder();
        const run = vi.fn(async (q: any) => (q === locked ? 'locked' : 'plain'));

        await expect(withLockIfSupported(qb, 'pessimistic_read', run)).resolves.toBe('locked');
    });

    it.each([
        ['the driver does not support locks', new LockNotSupportedOnGivenDriverError()],
        ['no transaction is open', new PessimisticLockTransactionRequiredError()],
    ])('falls back to a plain read when %s', async (_, error) => {
        const { qb, locked } = fakeQueryBuilder();
        const run = vi.fn(async (q: any) => {
            if (q === locked) throw error;
            return 'plain';
        });

        await expect(withLockIfSupported(qb, 'pessimistic_write', run)).resolves.toBe('plain');
    });

    it('rethrows any other error', async () => {
        const { qb } = fakeQueryBuilder();
        const run = vi.fn(async () => {
            throw new Error('connection lost');
        });

        await expect(withLockIfSupported(qb, 'pessimistic_read', run)).rejects.toThrow('connection lost');
    });
});
