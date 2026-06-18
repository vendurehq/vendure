import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';

import { TransactionInterceptor } from '../middleware/transaction-interceptor';

export const TRANSACTION_MODE_METADATA_KEY = '__transaction_mode__';
/**
 * @description
 * The Transaction decorator can handle transactions automatically (which is the default) or be set to
 * "manual" mode, where the {@link TransactionalConnection} `.startTransaction()` and `.commitOpenTransaction()`
 * methods must them be used.
 *
 * @example
 * ```ts
 * // in a GraphQL resolver file
 *
 * \@Transaction('manual')
 * async myMutation(\@Ctx() ctx: RequestContext) {
 *   await this.connection.startTransaction(ctx);
 *   const result = this.myService.createThing(ctx);
 *   const thing = this.myService.updateOtherThing(ctx, result.id);
 *   await this.connection.commitOpenTransaction(ctx);
 *   return thing;
 * }
 * ```
 * Note that even in manual mode, a rollback will be automatically performed in
 * the case that an uncaught error is thrown within the resolver.
 *
 * @default 'auto'
 * @docsCategory request
 * @docsPage Transaction Decorator
 */
export type TransactionMode = 'auto' | 'manual';

export const TRANSACTION_ISOLATION_LEVEL_METADATA_KEY = '__transaction_isolation_level__';
/**
 * @description
 * Transactions can be run at different isolation levels. The default is undefined, which
 * falls back to the default of your database. See the documentation of your database for more
 * information on available isolation levels.
 *
 * @default undefined
 * @docsCategory request
 * @docsPage Transaction Decorator
 */
export type TransactionIsolationLevel =
    | 'READ UNCOMMITTED'
    | 'READ COMMITTED'
    | 'REPEATABLE READ'
    | 'SERIALIZABLE';

/**
 * @description
 * Runs the decorated method in a TypeORM transaction. It works by creating a transactional
 * QueryRunner which gets attached to the RequestContext object. When the RequestContext
 * is the passed to the {@link TransactionalConnection} `getRepository()` method, this
 * QueryRunner is used to execute the queries within this transaction.
 *
 * Essentially, the entire resolver function is wrapped in a try-catch block which commits the
 * transaction on successful completion of the method, or rolls back the transaction in an unhandled
 * error is thrown.
 *
 * @example
 * ```ts
 * // in a GraphQL resolver file
 *
 * \@Transaction()
 * async myMutation(\@Ctx() ctx: RequestContext) {
 *   // as long as the `ctx` object is passed in to
 *   // all database operations, the entire mutation
 *   // will be run as an atomic transaction, and rolled
 *   // back if an error is thrown.
 *   const result = this.myService.createThing(ctx);
 *   return this.myService.updateOtherThing(ctx, result.id);
 * }
 * ```
 *
 * @docsCategory request
 * @docsPage Transaction Decorator
 * @docsWeight 0
 */
export const Transaction = (
    transactionMode: TransactionMode = 'auto',
    transactionIsolationLevel?: TransactionIsolationLevel,
) => {
    return applyDecorators(
        SetMetadata(TRANSACTION_MODE_METADATA_KEY, transactionMode),
        SetMetadata(TRANSACTION_ISOLATION_LEVEL_METADATA_KEY, transactionIsolationLevel),
        UseInterceptors(TransactionInterceptor),
    );
};
