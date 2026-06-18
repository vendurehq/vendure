import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of } from 'rxjs';

import { internal_getRequestContext, internal_setRequestContext, RequestContext } from '..';
import { TransactionWrapper } from '../../connection/transaction-wrapper';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { parseContext } from '../common/parse-context';
import {
    TRANSACTION_ISOLATION_LEVEL_METADATA_KEY,
    TRANSACTION_MODE_METADATA_KEY,
    TransactionIsolationLevel,
    TransactionMode,
} from '../decorators/transaction.decorator';

/**
 * @description
 * Used by the {@link Transaction} decorator to create a transactional query runner
 * and attach it to the RequestContext.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
    constructor(
        private connection: TransactionalConnection,
        private transactionWrapper: TransactionWrapper,
        private reflector: Reflector,
    ) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const { req } = parseContext(context);
        const ctx: RequestContext | undefined = internal_getRequestContext(req, context);
        if (ctx) {
            const transactionMode = this.reflector.get<TransactionMode>(
                TRANSACTION_MODE_METADATA_KEY,
                context.getHandler(),
            );
            const transactionIsolationLevel = this.reflector.get<TransactionIsolationLevel | undefined>(
                TRANSACTION_ISOLATION_LEVEL_METADATA_KEY,
                context.getHandler(),
            );

            return of(
                this.transactionWrapper.executeInTransaction(
                    ctx,
                    _ctx => {
                        // Registers transactional request context associated
                        // with execution handler function
                        internal_setRequestContext(req, _ctx, context);

                        return next.handle();
                    },
                    transactionMode,
                    transactionIsolationLevel,
                    this.connection.rawConnection,
                ),
            );
        } else {
            return next.handle();
        }
    }
}
