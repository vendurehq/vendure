import { Injectable } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TransactionAlreadyStartedError } from 'typeorm/error/TransactionAlreadyStartedError';

import { RequestContext } from '../api/common/request-context';
import { TransactionIsolationLevel, TransactionMode } from '../api/decorators/transaction.decorator';
import { TRANSACTION_MANAGER_KEY, TRANSACTION_NO_RETRY_KEY } from '../common/constants';
import { ConfigService } from '../config/config.service';
import { Logger } from '../config/logger/vendure-logger';

import { getDatabaseType } from './database-type';
import { isRetriableTransactionError } from './is-retriable-transaction-error';
import { TransactionSubscriber } from './transaction-subscriber';

/**
 * @description
 * This helper class is used to wrap operations in a TypeORM transaction in order to ensure
 * atomic operations on the database.
 */
@Injectable()
export class TransactionWrapper {
    constructor(
        private configService: ConfigService,
        private transactionSubscriber: TransactionSubscriber,
    ) {}

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
        let queryRunner = inheritedQueryRunner ?? connection.createQueryRunner();
        const effectiveIsolationLevel = this.resolveIsolationLevel(isolationLevel, connection);
        if (mode === 'auto') {
            await this.startTransaction(queryRunner, effectiveIsolationLevel);
        }
        if (!inheritedQueryRunner) {
            // Only the owner of the runner clears the mark: a nested transaction which runs after
            // the mark was set must not erase it. (SQLite drivers share one runner between requests.)
            delete queryRunner.data[TRANSACTION_NO_RETRY_KEY];
        }
        (ctx as any)[TRANSACTION_MANAGER_KEY] = queryRunner.manager;

        try {
            const result = await this.runWithRetries(
                () => work(ctx),
                () => queryRunner,
                // A retry has to roll the transaction back and start a fresh one. That is only
                // ours to do when we opened the transaction in the first place. When the runner
                // was inherited from an outer transaction, or the caller manages the transaction
                // itself, the retry belongs to whoever owns it.
                mode === 'auto' && !inheritedQueryRunner
                    ? async () => {
                          queryRunner = await this.restartTransaction(
                              queryRunner,
                              connection,
                              effectiveIsolationLevel,
                          );
                          (ctx as any)[TRANSACTION_MANAGER_KEY] = queryRunner.manager;
                      }
                    : undefined,
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
     * Runs the unit of work, retrying it from the top if the database rejects it with an error
     * which is expected to succeed on a second attempt, such as a deadlock.
     *
     * The transaction must be rolled back and restarted between attempts. Once the database has
     * aborted a transaction, every subsequent statement on it fails, so retrying the work on the
     * same transaction cannot succeed.
     *
     * Note that a retry re-runs the whole unit of work, so any side effect it performs happens
     * again. DB writes are discarded by the rollback, and events published inside a transaction
     * are only flushed on commit, but anything else the work touches is replayed. An attempt
     * which marked itself with `TransactionalConnection.preventTransactionRetry()` is therefore
     * never retried.
     */
    private async runWithRetries<T>(
        work: () => Observable<T> | Promise<T>,
        getQueryRunner: () => QueryRunner,
        restartTransaction: (() => Promise<void>) | undefined,
    ): Promise<T> {
        const maxRetries = 5;
        let attempts = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                return await lastValueFrom(from(work()));
            } catch (err: any) {
                attempts++;
                if (
                    !restartTransaction ||
                    !isRetriableTransactionError(err) ||
                    attempts > maxRetries ||
                    // The attempt did something a rollback cannot undo, such as calling a payment
                    // provider, so running it again would repeat that. See
                    // TransactionalConnection.preventTransactionRetry.
                    getQueryRunner().data[TRANSACTION_NO_RETRY_KEY] === true
                ) {
                    throw err;
                }
                await restartTransaction();
            }
        }
    }

    /**
     * Ends the transaction of a failed attempt and starts a new one for the next attempt, returning
     * the QueryRunner to use from then on.
     *
     * That is a new QueryRunner when the old one can no longer be trusted. When the database ended
     * the transaction inside a nested transaction, as MySQL and MariaDB do on a deadlock, TypeORM
     * still counts the savepoint: rolling back fails again, and starting a transaction on that
     * runner would only create another savepoint. The old runner is then reset and released, as in
     * `rollbackAfterError()`.
     */
    private async restartTransaction(
        queryRunner: QueryRunner,
        connection: DataSource,
        isolationLevel: TransactionIsolationLevel | undefined,
    ): Promise<QueryRunner> {
        try {
            if (queryRunner.isTransactionActive) {
                await queryRunner.rollbackTransaction();
            }
            if (!queryRunner.isTransactionActive) {
                await this.startTransaction(queryRunner, isolationLevel);
                return queryRunner;
            }
        } catch {
            // Handled below
        }
        await queryRunner.query('ROLLBACK').catch(() => undefined);
        this.transactionSubscriber.announceRollback(queryRunner);
        if (!queryRunner.isReleased) {
            await queryRunner.release();
        }
        const freshQueryRunner = connection.createQueryRunner();
        try {
            await this.startTransaction(freshQueryRunner, isolationLevel);
        } catch (e) {
            await freshQueryRunner.release();
            throw e;
        }
        return freshQueryRunner;
    }

    /**
     * The isolation level asked for explicitly wins. Otherwise the configured
     * `entityOptions.transactionIsolationLevel` applies, then an `isolationLevel` set in
     * `dbConnectionOptions` (an option of TypeORM v1's DataSource, which TypeORM 0.3 does not
     * have), and failing those `READ COMMITTED` on MySQL and MariaDB.
     *
     * InnoDB defaults to `REPEATABLE READ`, under which a transaction keeps reading the snapshot
     * taken at its first read. A row lock acquired later then cannot make the transaction see the
     * data committed by the transaction it waited for, so concurrent writes to an Order would
     * still be lost, and on MariaDB 11.6.2+ they fail with `ER_CHECKREAD` instead. `READ COMMITTED`
     * is also the default on Postgres, which is why the other databases are left alone.
     */
    resolveIsolationLevel(
        requested: TransactionIsolationLevel | undefined,
        connection: DataSource,
    ): TransactionIsolationLevel | undefined {
        if (requested) {
            return requested;
        }
        const configured = this.configService.entityOptions.transactionIsolationLevel;
        if (configured) {
            return configured;
        }
        const fromDataSource = (connection.options as { isolationLevel?: TransactionIsolationLevel })
            .isolationLevel;
        if (fromDataSource) {
            return fromDataSource;
        }
        const dbType = getDatabaseType(connection);
        return dbType === 'mysql' || dbType === 'mariadb' ? 'READ COMMITTED' : undefined;
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
}
