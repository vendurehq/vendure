/**
 * Whether the database rejected a transaction with an error which a fresh attempt of the same
 * work can be expected to get past: a deadlock, or a failure to serialize it against a concurrent
 * transaction. `TransactionWrapper` retries the transactions it owns on these errors, so code
 * which catches errors inside a transaction should let them through.
 */
export function isRetriableTransactionError(err: any): boolean {
    // MySQL and MariaDB report both deadlocks and serialization failures as ER_LOCK_DEADLOCK.
    const mysqlDeadlock = err?.code === 'ER_LOCK_DEADLOCK';
    // node-postgres puts the SQLSTATE in `err.code`, so a deadlock arrives as '40P01' rather
    // than as its condition name. The name is kept too in case a driver reports it that way.
    const postgresDeadlock = err?.code === 'deadlock_detected' || err?.code === '40P01';
    // Raised in place of a deadlock when the database cannot order this transaction against a
    // concurrent one, which happens at SERIALIZABLE and on Postgres at REPEATABLE READ.
    const serializationFailure = err?.code === '40001';
    return mysqlDeadlock || postgresDeadlock || serializationFailure;
}
