import { Injectable } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import { retryWhen, take, tap } from 'rxjs/operators';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TransactionAlreadyStartedError } from 'typeorm/error/TransactionAlreadyStartedError';

import { RequestContext } from '../api/common/request-context';
import { TransactionIsolationLevel, TransactionMode } from '../api/decorators/transaction.decorator';
import { TRANSACTION_MANAGER_KEY } from '../common/constants';
import { Logger } from '../config/logger/vendure-logger';

import { TransactionSubscriber } from './transaction-subscriber';

/**
 * @description
 * This helper class is used to wrap operations in a TypeORM transaction in order to ensure
 * atomic operations on the database.
 */
@Injectable()
export class TransactionWrapper {
    constructor(private transactionSubscriber: TransactionSubscriber) {}

    /**
     * @description
     * Executes the `work` function within the context of a transaction. If the `work` function
     * resolves / completes, then all the DB operations it contains will be committed. If it
     * throws an error or rejects, then all DB operations will be rolled back.
     *
     * @note
     * This function does not mutate your context. Instead, this function makes a copy and passes
     * context to work function.
     */
    async executeInTransaction<T>(
        originalCtx: RequestContext,
        work: (ctx: RequestContext) => Observable<T> | Promise<T>,
        mode: TransactionMode,
        isolationLevel: TransactionIsolationLevel | undefined,
        connection: DataSource,
    ): Promise<T> {
        // Copy to make sure original context will remain valid after transaction completes
        const ctx = originalCtx.copy();

        const entityManager: EntityManager | undefined = (ctx as any)[TRANSACTION_MANAGER_KEY];
        const inheritedQueryRunner =
            entityManager?.queryRunner && !entityManager.queryRunner.isReleased
                ? entityManager.queryRunner
                : undefined;
        const queryRunner = inheritedQueryRunner ?? connection.createQueryRunner();
        if (mode === 'auto') {
            await this.startTransaction(queryRunner, isolationLevel);
        }
        (ctx as any)[TRANSACTION_MANAGER_KEY] = queryRunner.manager;

        try {
            const maxRetries = 5;
            const result = await lastValueFrom(
                from(work(ctx)).pipe(
                    retryWhen(errors =>
                        errors.pipe(
                            tap(err => {
                                if (!this.isRetriableError(err)) {
                                    throw err;
                                }
                            }),
                            take(maxRetries),
                        ),
                    ),
                ),
            );
            if (queryRunner.isTransactionActive) {
                await queryRunner.commitTransaction();
            }
            return result;
        } catch (error) {
            if (queryRunner.isTransactionActive) {
                await this.rollbackAfterError(queryRunner, !inheritedQueryRunner);
            }
            throw error;
        } finally {
            // Only release the QueryRunner if we created it ourselves. If it was inherited
            // from an outer transaction (e.g. a @Transaction('manual') caller), releasing it
            // would invalidate the caller's context. The active-transaction check additionally
            // covers the nested-savepoint case where the parent transaction is still open.
            if (
                !inheritedQueryRunner &&
                !queryRunner.isTransactionActive &&
                queryRunner.isReleased === false
            ) {
                await queryRunner.release();
            }
        }
    }

    /**
     * Rolls back after the work has failed, so that the original error can be rethrown.
     *
     * The rollback itself can fail when the database has already ended the transaction. MySQL and
     * MariaDB roll back the whole transaction, not only the statement, on a deadlock (and MariaDB
     * 11.6.2+ also on `ER_CHECKREAD`), so a nested transaction's `ROLLBACK TO SAVEPOINT` fails
     * because the savepoint is gone. TypeORM then leaves the QueryRunner marked as in a
     * transaction, and the `finally` block of `executeInTransaction()` only releases a runner which
     * is not, so the connection would never return to the pool.
     *
     * A failed rollback therefore never replaces the original error. A nested transaction leaves
     * the cleanup to the owner of the QueryRunner: the owner's catch block calls this method again
     * with `ownsQueryRunner` set, which ends what is left of the transaction with a plain
     * `ROLLBACK`, tells the TransactionSubscriber that it was rolled back, so that the events
     * published in it are dropped as after any rollback, and releases the connection.
     *
     * On SQLite drivers this case is not handled: they share one QueryRunner, whose state the
     * release does not reset. Only errors such as `SQLITE_FULL` end a SQLite transaction early.
     */
    private async rollbackAfterError(queryRunner: QueryRunner, ownsQueryRunner: boolean) {
        try {
            await queryRunner.rollbackTransaction();
        } catch (rollbackError: any) {
            if (!ownsQueryRunner) {
                return;
            }
            Logger.warn(
                `Rolling back a failed transaction failed, so the connection is reset and released: ${String(
                    rollbackError?.message ?? rollbackError,
                )}`,
            );
            await queryRunner.query('ROLLBACK').catch(() => undefined);
            this.transactionSubscriber.announceRollback(queryRunner);
            if (!queryRunner.isReleased) {
                await queryRunner.release();
            }
        }
    }

    /**
     * Attempts to start a DB transaction, with retry logic in the case that a transaction
     * is already started for the connection (which is mainly a problem with SQLite/Sql.js)
     */
    private async startTransaction(
        queryRunner: QueryRunner,
        isolationLevel: TransactionIsolationLevel | undefined,
    ) {
        const maxRetries = 25;
        let attempts = 0;
        let lastError: any;

        // Returns false if a transaction is already in progress
        async function attemptStartTransaction(): Promise<boolean> {
            try {
                await queryRunner.startTransaction(isolationLevel);
                return true;
            } catch (err: any) {
                lastError = err;
                if (err instanceof TransactionAlreadyStartedError) {
                    return false;
                }
                throw err;
            }
        }

        while (attempts < maxRetries) {
            const result = await attemptStartTransaction();
            if (result) {
                return;
            }
            attempts++;
            // insert an increasing delay before retrying
            await new Promise(resolve => setTimeout(resolve, attempts * 20));
        }
        throw lastError;
    }

    /**
     * If the resolver function throws an error, there are certain cases in which
     * we want to retry the whole thing again - notably in the case of a deadlock
     * situation, which can usually be retried with success.
     */
    private isRetriableError(err: any): boolean {
        const mysqlDeadlock = err.code === 'ER_LOCK_DEADLOCK';
        const postgresDeadlock = err.code === 'deadlock_detected';
        return mysqlDeadlock || postgresDeadlock;
    }
}
