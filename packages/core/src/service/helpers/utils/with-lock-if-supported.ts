import { LockNotSupportedOnGivenDriverError, ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Runs the query as a locking read (`SELECT ... FOR UPDATE` / `FOR SHARE`), falling back to a
 * plain read on drivers which do not support locks. SQLite is the case in point: it serializes
 * writes itself, so the plain read is safe there.
 *
 * A locking read also reads the latest committed rows. Under REPEATABLE READ (the MySQL and
 * MariaDB default) a plain read inside a transaction sees the snapshot taken at the
 * transaction's first read, and would miss a concurrent transaction's committed write even
 * after a lock has been acquired.
 */
export async function withLockIfSupported<E extends ObjectLiteral, T>(
    qb: SelectQueryBuilder<E>,
    lockMode: 'pessimistic_read' | 'pessimistic_write',
    run: (qb: SelectQueryBuilder<E>) => Promise<T>,
): Promise<T> {
    try {
        return await run(qb.clone().setLock(lockMode));
    } catch (e) {
        if (!(e instanceof LockNotSupportedOnGivenDriverError)) {
            throw e;
        }
        return run(qb);
    }
}
