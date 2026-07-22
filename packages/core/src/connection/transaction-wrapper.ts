import { from, lastValueFrom, Observable } from 'rxjs';
import { retryWhen, take, tap } from 'rxjs/operators';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TransactionAlreadyStartedError } from 'typeorm/error/TransactionAlreadyStartedError';

import { RequestContext } from '../api/common/request-context';
import { TransactionIsolationLevel, TransactionMode } from '../api/decorators/transaction.decorator';
import { TRANSACTION_MANAGER_KEY } from '../common/constants';

/**
 * @description
 * This helper class is used to wrap operations in a TypeORM transaction in order to ensure
 * atomic operations on the database.
 */
export class TransactionWrapper {
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
                await queryRunner.rollbackTransaction();
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
