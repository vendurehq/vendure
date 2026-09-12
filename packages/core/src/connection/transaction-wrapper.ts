import { from, lastValueFrom, Observable } from 'rxjs';
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
            const result = await this.runWithRetries(
                () => work(ctx),
                queryRunner,
                isolationLevel,
                // A retry has to roll the transaction back and start a fresh one. That is only
                // ours to do when we opened the transaction in the first place. When the runner
                // was inherited from an outer transaction, or the caller manages the transaction
                // itself, the retry belongs to whoever owns it.
                mode === 'auto' && !inheritedQueryRunner,
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
     * Runs the unit of work, retrying it from the top if the database rejects it with an error
     * which is expected to succeed on a second attempt, such as a deadlock.
     *
     * The transaction must be rolled back and restarted between attempts. Once the database has
     * aborted a transaction, every subsequent statement on it fails, so retrying the work on the
     * same transaction cannot succeed.
     *
     * Note that a retry re-runs the whole unit of work, so any side effect it performs happens
     * again. DB writes are discarded by the rollback, and events published inside a transaction
     * are only flushed on commit, but anything else the work touches is replayed.
     */
    private async runWithRetries<T>(
        work: () => Observable<T> | Promise<T>,
        queryRunner: QueryRunner,
        isolationLevel: TransactionIsolationLevel | undefined,
        canRestartTransaction: boolean,
    ): Promise<T> {
        const maxRetries = 5;
        let attempts = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                return await lastValueFrom(from(work()));
            } catch (err: any) {
                attempts++;
                if (!canRestartTransaction || !this.isRetriableError(err) || attempts > maxRetries) {
                    throw err;
                }
                if (queryRunner.isTransactionActive) {
                    await queryRunner.rollbackTransaction();
                }
                await this.startTransaction(queryRunner, isolationLevel);
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
        // MySQL and MariaDB report both deadlocks and serialization failures as ER_LOCK_DEADLOCK.
        const mysqlDeadlock = err.code === 'ER_LOCK_DEADLOCK';
        // node-postgres puts the SQLSTATE in `err.code`, so a deadlock arrives as '40P01' rather
        // than as its condition name. The name is kept too in case a driver reports it that way.
        const postgresDeadlock = err.code === 'deadlock_detected' || err.code === '40P01';
        // Raised in place of a deadlock when the database cannot order this transaction against a
        // concurrent one, which happens at SERIALIZABLE and on Postgres at REPEATABLE READ.
        const serializationFailure = err.code === '40001';
        return mysqlDeadlock || postgresDeadlock || serializationFailure;
    }
}
