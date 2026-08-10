import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/typeorm';
import { lastValueFrom, merge, ObservableInput, Subject } from 'rxjs';
import { delay, filter, map, take, tap } from 'rxjs/operators';
import { Connection, EntitySubscriberInterface } from 'typeorm';
import { EntityManager } from 'typeorm/entity-manager/EntityManager';
import { QueryRunner } from 'typeorm/query-runner/QueryRunner';
import { TransactionCommitEvent } from 'typeorm/subscriber/event/TransactionCommitEvent';
import { TransactionRollbackEvent } from 'typeorm/subscriber/event/TransactionRollbackEvent';

/**
 * This error should be thrown by an event subscription if types do not match
 *
 * @internal
 */
export class TransactionSubscriberError extends Error {}

export type TransactionSubscriberEventType = 'commit' | 'rollback';

export interface TransactionSubscriberEvent {
    /**
     * Event type. Either commit or rollback.
     */
    type: TransactionSubscriberEventType;

    /**
     * Connection used in the event.
     */
    connection: Connection;
    /**
     * QueryRunner used in the event transaction.
     * All database operations in the subscribed event listener should be performed using this query runner instance.
     */
    queryRunner: QueryRunner;
    /**
     * EntityManager used in the event transaction.
     * All database operations in the subscribed event listener should be performed using this entity manager instance.
     */
    manager: EntityManager;
}

/**
 * This subscriber listens to all transaction commit/rollback events emitted by TypeORM
 * so that we can be notified as soon as a particular queryRunner's transactions ends.
 *
 * This is used by the {@link EventBus} to prevent events from being published until their
 * associated transactions are complete.
 */
@Injectable()
export class TransactionSubscriber implements EntitySubscriberInterface {
    private subject$ = new Subject<TransactionSubscriberEvent>();

    constructor(@InjectConnection() private connection: Connection) {
        if (!connection.subscribers.find(subscriber => subscriber.constructor === TransactionSubscriber)) {
            connection.subscribers.push(this);
        }
    }

    afterTransactionCommit(event: TransactionCommitEvent) {
        this.subject$.next({
            type: 'commit',
            ...event,
        });
    }

    afterTransactionRollback(event: TransactionRollbackEvent) {
        this.subject$.next({
            type: 'rollback',
            ...event,
        });
    }

    awaitCommit(queryRunner: QueryRunner): Promise<QueryRunner> {
        return this.awaitTransactionEvent(queryRunner, 'commit');
    }

    awaitRollback(queryRunner: QueryRunner): Promise<QueryRunner> {
        return this.awaitTransactionEvent(queryRunner, 'rollback');
    }

    awaitRelease(queryRunner: QueryRunner): Promise<QueryRunner> {
        return this.awaitTransactionEvent(queryRunner);
    }

    private awaitTransactionEvent(
        queryRunner: QueryRunner,
        type?: TransactionSubscriberEventType,
    ): Promise<QueryRunner> {
        if (queryRunner.isTransactionActive) {
            return lastValueFrom(this.subject$
                .pipe(
                    filter(
                        event => !event.queryRunner.isTransactionActive && event.queryRunner === queryRunner,
                    ),
                    take(1),
                    tap(event => {
                        if (type && event.type !== type) {
                            throw new TransactionSubscriberError(`Unexpected event type: ${event.type}. Expected ${type}.`);
                        }
                    }),
                    map(event => event.queryRunner),
                    // This `delay(0)` call appears to be necessary with the upgrade to TypeORM
                    // v0.2.41, otherwise an active queryRunner can still get picked up in an event
                    // subscriber function. This is manifested by the e2e test
                    // "Transaction infrastructure › passing transaction via EventBus" failing
                    // in the database-transactions.e2e-spec.ts suite, and a bunch of errors
                    // in the default-search-plugin.e2e-spec.ts suite when using sqljs.
                    delay(0),
                )
            );
        } else {
            return Promise.resolve(queryRunner);
        }
    }
}
