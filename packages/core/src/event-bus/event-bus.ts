import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Type } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { Observable, Subject } from 'rxjs';
import { filter, mergeMap, takeUntil } from 'rxjs/operators';
import { EntityManager } from 'typeorm';

import { RequestContext } from '../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../common/constants';
import { Instrument } from '../common/instrument-decorator';
import { Logger } from '../config/logger/vendure-logger';
import { TransactionSubscriber, TransactionSubscriberError } from '../connection/transaction-subscriber';

import { VendureEvent } from './vendure-event';

/**
 * @description
 * Options for registering a blocking event handler.
 *
 * @since 2.2.0
 * @docsCategory events
 */
export type BlockingEventHandlerOptions<T extends VendureEvent> = {
    /**
     * @description
     * The event type to which the handler should listen.
     * Can be a single event type or an array of event types.
     */
    event: Type<T> | Array<Type<T>>;
    /**
     * @description
     * The handler function which will be executed when the event is published.
     * If the handler returns a Promise, the event publishing code will wait for the Promise to resolve
     * before continuing. Any errors thrown by the handler will cause the event publishing code to fail.
     */
    handler: (event: T) => void | Promise<void>;
    /**
     * @description
     * A unique identifier for the handler. This can then be used to specify the order in which
     * handlers should be executed using the `before` and `after` options in other handlers.
     */
    id: string;
    /**
     * @description
     * The ID of another handler which this handler should execute before.
     */
    before?: string;
    /**
     * @description
     * The ID of another handler which this handler should execute after.
     */
    after?: string;
};

/**
 * @description
 * The EventBus is used to globally publish events which can then be subscribed to.
 *
 * Events are published whenever certain actions take place within the Vendure server, for example:
 *
 * * when a Product is updated ({@link ProductEvent})
 * * when an Order transitions state ({@link OrderStateTransitionEvent})
 * * when a Customer registers a new account ({@link AccountRegistrationEvent})
 *
 * Using the EventBus it is possible to subscribe to and take action when these events occur.
 * This is done with the `.ofType()` method, which takes an event type and returns an rxjs observable
 * stream of events:
 *
 * @example
 * ```ts
 * import { OnApplicationBootstrap } from '\@nestjs/common';
 * import { EventBus, PluginCommonModule, VendurePlugin } from '\@vendure/core';
 * import { filter } from 'rxjs/operators';
 *
 * \@VendurePlugin({
 *     imports: [PluginCommonModule]
 * })
 * export class MyPlugin implements OnApplicationBootstrap {
 *
 *   constructor(private eventBus: EventBus) {}
 *
 *   async onApplicationBootstrap() {
 *
 *     this.eventBus
 *       .ofType(OrderStateTransitionEvent)
 *       .pipe(
 *         filter(event => event.toState === 'PaymentSettled'),
 *       )
 *       .subscribe((event) => {
 *         // do some action when this event fires
 *       });
 *   }
 * }
 * ```
 *
 * @docsCategory events
 * */
@Injectable()
@Instrument()
export class EventBus implements OnModuleDestroy {
    private eventStream = new Subject<VendureEvent>();
    private destroy$ = new Subject<void>();
    private blockingEventHandlers = new Map<Type<VendureEvent>, Array<BlockingEventHandlerOptions<any>>>();

    constructor(private transactionSubscriber: TransactionSubscriber) {}

    /**
     * @description
     * Publish an event which any subscribers can react to.
     *
     * @example
     * ```ts
     * await eventBus.publish(new SomeEvent());
     * ```
     */
    async publish<T extends VendureEvent>(event: T): Promise<void> {
        this.eventStream.next(event);
        await this.executeBlockingEventHandlers(event);
    }

    /**
     * @description
     * Returns an RxJS Observable stream of events of the given type.
     * If the event contains a {@link RequestContext} object, the subscriber
     * will only get called after any active database transactions are complete.
     *
     * This means that the subscriber function can safely access all updated
     * data related to the event.
     */
    ofType<T extends VendureEvent>(type: Type<T>): Observable<T> {
        return this.eventStream.asObservable().pipe(
            takeUntil(this.destroy$),
            filter(e => e.constructor === type),
            mergeMap(event => this.awaitActiveTransactions(event)),
            filter(notNullOrUndefined),
        ) as Observable<T>;
    }

    /**
     * @description
     * Returns an RxJS Observable stream of events filtered by a custom predicate.
     * If the event contains a {@link RequestContext} object, the subscriber
     * will only get called after any active database transactions are complete.
     *
     * This means that the subscriber function can safely access all updated
     * data related to the event.
     */
    filter<T extends VendureEvent>(predicate: (event: VendureEvent) => boolean): Observable<T> {
        return this.eventStream.asObservable().pipe(
            takeUntil(this.destroy$),
            filter(e => predicate(e)),
            mergeMap(event => this.awaitActiveTransactions(event)),
            filter(notNullOrUndefined),
        ) as Observable<T>;
    }

    /**
     * @description
     * Register an event handler function which will be executed when an event of the given type is published,
     * and will block execution of the code which published the event until the handler has completed.
     *
     * This is useful when you need assurance that the event handler has successfully completed, and you want
     * the triggering code to fail if the handler fails.
     *
     * ::: warning
     * This API should be used with caution, as errors or performance issues in the handler can cause the
     * associated operation to be slow or fail entirely. For this reason, any handler which takes longer than
     * 100ms to execute will log a warning. Any non-trivial task to be performed in a blocking event handler
     * should be offloaded to a background job using the {@link JobQueueService}.
     *
     * Also, be aware that the handler will be executed in the _same database transaction_ as the code which published
     * the event (as long as you pass the `ctx` object from the event to any TransactionalConnection calls).
     * :::
     *
     * @example
     * ```ts
     * eventBus.registerBlockingEventHandler({
     *   event: OrderStateTransitionEvent,
     *   id: 'my-order-state-transition-handler',
     *   handler: async (event) => {
     *     // perform some synchronous task
     *   }
     * });
     * ```
     *
     * @since 2.2.0
     */
    registerBlockingEventHandler<T extends VendureEvent>(handlerOptions: BlockingEventHandlerOptions<T>) {
        const events = Array.isArray(handlerOptions.event) ? handlerOptions.event : [handlerOptions.event];

        for (const event of events) {
            let handlers = this.blockingEventHandlers.get(event);
            const handlerWithIdAlreadyExists = handlers?.some(h => h.id === handlerOptions.id);
            if (handlerWithIdAlreadyExists) {
                throw new Error(
                    `A handler with the id "${handlerOptions.id}" is already registered for the event ${event.name}`,
                );
            }

            if (handlers) {
                handlers.push(handlerOptions);
            } else {
                handlers = [handlerOptions];
            }
            const orderedHandlers = this.orderEventHandlers(handlers);
            this.blockingEventHandlers.set(event, orderedHandlers);
        }
    }

    /** @internal */
    onModuleDestroy(): any {
        this.destroy$.next();
    }

    private async executeBlockingEventHandlers<T extends VendureEvent>(event: T): Promise<void> {
        const blockingHandlers = this.blockingEventHandlers.get(event.constructor as Type<T>);
        for (const options of blockingHandlers || []) {
            const timeStart = new Date().getTime();
            await options.handler(event);
            const timeEnd = new Date().getTime();
            const timeTaken = timeEnd - timeStart;
            Logger.debug(`Blocking event handler ${options.id} took ${timeTaken}ms`);
            if (timeTaken > 100) {
                Logger.warn(
                    [
                        `Blocking event handler ${options.id} took ${timeTaken}ms`,
                        `Consider optimizing the handler by moving the logic to a background job or using a more efficient algorithm.`,
                    ].join('\n'),
                );
            }
        }
    }

    private orderEventHandlers<T extends VendureEvent>(
        handlers: Array<BlockingEventHandlerOptions<T>>,
    ): Array<BlockingEventHandlerOptions<T>> {
        let orderedHandlers: Array<BlockingEventHandlerOptions<T>> = [];
        const handlerMap: Map<string, BlockingEventHandlerOptions<T>> = new Map();

        // Create a map of handlers by ID for efficient lookup
        for (const handler of handlers) {
            handlerMap.set(handler.id, handler);
        }

        // Helper function to recursively add handlers in correct order
        const addHandler = (handler: BlockingEventHandlerOptions<T>) => {
            // If the handler is already in the ordered list, skip it
            if (orderedHandlers.includes(handler)) {
                return;
            }

            // If an "after" handler is specified, add it recursively
            if (handler.after) {
                const afterHandler = handlerMap.get(handler.after);
                if (afterHandler) {
                    if (afterHandler.after === handler.id) {
                        throw new Error(
                            `Circular dependency detected between event handlers ${handler.id} and ${afterHandler.id}`,
                        );
                    }
                    orderedHandlers = orderedHandlers.filter(h => h.id !== afterHandler.id);
                    addHandler(afterHandler);
                }
            }

            // Add the current handler
            orderedHandlers.push(handler);

            // If a "before" handler is specified, add it recursively
            if (handler.before) {
                const beforeHandler = handlerMap.get(handler.before);
                if (beforeHandler) {
                    if (beforeHandler.before === handler.id) {
                        throw new Error(
                            `Circular dependency detected between event handlers ${handler.id} and ${beforeHandler.id}`,
                        );
                    }
                    orderedHandlers = orderedHandlers.filter(h => h.id !== beforeHandler.id);
                    addHandler(beforeHandler);
                }
            }
        };

        // Start adding handlers from the original list
        for (const handler of handlers) {
            addHandler(handler);
        }

        return orderedHandlers;
    }

    /**
     * If the Event includes a RequestContext property, we need to check for any active transaction
     * associated with it, and if there is one, we await that transaction to either commit or rollback
     * before publishing the event.
     *
     * The reason for this is that if the transaction is still active when event subscribers execute,
     * this can cause a couple of issues:
     *
     * 1. If the transaction hasn't completed by the time the subscriber runs, the new data inside
     *  the transaction will not be available to the subscriber.
     * 2. If the subscriber gets a reference to the EntityManager which has an active transaction,
     *   and then the transaction completes, and then the subscriber attempts a DB operation using that
     *   EntityManager, a fatal QueryRunnerAlreadyReleasedError will be thrown.
     *
     * For more context on these two issues, see:
     *
     * * https://github.com/vendurehq/vendure/issues/520
     * * https://github.com/vendurehq/vendure/issues/1107
     */
    private async awaitActiveTransactions<T extends VendureEvent>(event: T): Promise<T | undefined> {
        const entry = Object.entries(event).find(([_, value]) => value instanceof RequestContext);

        if (!entry) {
            return event;
        }

        const [key, ctx]: [string, RequestContext] = entry;

        const transactionManager: EntityManager | undefined = (ctx as any)[TRANSACTION_MANAGER_KEY];
        if (!transactionManager?.queryRunner) {
            return event;
        }

        try {
            await this.transactionSubscriber.awaitCommit(transactionManager.queryRunner);

            // Copy context and remove transaction manager
            // This will prevent queries to released query runner
            const newContext = ctx.copy();
            delete (newContext as any)[TRANSACTION_MANAGER_KEY];

            // Reassign new context
            (event as any)[key] = newContext;

            return event;
        } catch (e: any) {
            if (e instanceof TransactionSubscriberError) {
                // Expected commit, but rollback or something else happened.
                // This is still reliable behavior, return undefined
                // as event should not be exposed from this transaction
                return;
            }

            throw e;
        }
    }
}
