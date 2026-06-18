import { ApolloQueryResult, NetworkStatus } from '@apollo/client/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { Apollo, QueryRef } from 'apollo-angular';
import { DocumentNode } from 'graphql';
import { merge, Observable, Subject, Subscription } from 'rxjs';
import {
    distinctUntilChanged,
    filter,
    finalize,
    map,
    shareReplay,
    skip,
    startWith,
    take,
    takeUntil,
} from 'rxjs/operators';

import { CustomFieldConfig, GetUserStatusQuery } from '../common/generated-types';

import { GET_USER_STATUS } from './definitions/client-definitions';
import { addCustomFields } from './utils/add-custom-fields';

/**
 * @description
 * This class wraps the Apollo Angular QueryRef object and exposes some getters
 * for convenience.
 *
 * @docsCategory services
 * @docsPage DataService
 */
export class QueryResult<T, V extends Record<string, any> = Record<string, any>> {
    constructor(
        private queryRef: QueryRef<T, V>,
        private apollo: Apollo,
        private customFieldMap: Map<string, CustomFieldConfig[]>,
    ) {
        this.lastQuery = queryRef.options.query;
    }

    /**
     * Causes any subscriptions to the QueryRef to complete, via the use
     * of the `takeUntil` operator.
     */
    private completed$ = new Subject<void>();
    /**
     * The subscription to the current QueryRef.valueChanges Observable.
     * This is stored so that it can be unsubscribed from when the QueryRef
     * changes.
     */
    private valueChangesSubscription: Subscription;
    /**
     * This Subject is used to emit new values from the QueryRef.valueChanges Observable.
     * We use this rather than directly subscribing to the QueryRef.valueChanges Observable
     * so that we are able to change the QueryRef and re-subscribe when necessary.
     */
    private valueChangeSubject = new Subject<ApolloQueryResult<T>>();
    /**
     * We keep track of the QueryRefs which have been subscribed to so that we can avoid
     * re-subscribing to the same QueryRef multiple times.
     */
    private queryRefSubscribed = new WeakMap<QueryRef<T, V>, boolean>();
    /**
     * We store a reference to the last query so that we can compare it with the next query
     * and avoid re-fetching the same query multiple times. This is applicable to the code
     * paths that actually change the query, i.e. refetchOnCustomFieldsChange().
     */
    private lastQuery: DocumentNode;

    /**
     * @description
     * Re-fetch this query whenever the active Channel changes.
     */
    refetchOnChannelChange(): QueryResult<T, V> {
        const userStatus$ = this.apollo.watchQuery<GetUserStatusQuery>({
            query: GET_USER_STATUS,
        }).valueChanges;
        const activeChannelId$ = userStatus$.pipe(
            map(data => data.data.userStatus.activeChannelId),
            filter(notNullOrUndefined),
            distinctUntilChanged(),
            skip(1),
            takeUntil(this.completed$),
        );
        const loggedOut$ = userStatus$.pipe(
            map(data => data.data.userStatus.isLoggedIn),
            distinctUntilChanged(),
            skip(1),
            filter(isLoggedIn => !isLoggedIn),
            takeUntil(this.completed$),
        );

        merge(activeChannelId$, this.valueChangeSubject)
            .pipe(takeUntil(loggedOut$), takeUntil(this.completed$))
            .subscribe(val => {
                if (typeof val === 'string') {
                    new Promise(resolve => setTimeout(resolve, 50)).then(() => this.queryRef.refetch());
                }
            });
        return this;
    }

    /**
     * @description
     * Re-fetch this query whenever the custom fields change, updating the query to include the
     * specified custom fields.
     *
     * @since 3.0.4
     */
    refetchOnCustomFieldsChange(customFieldsToInclude$: Observable<string[]>): QueryResult<T, V> {
        customFieldsToInclude$
            .pipe(
                filter(customFields => {
                    const newQuery = addCustomFields(this.lastQuery, this.customFieldMap, customFields);
                    const hasChanged = JSON.stringify(newQuery) !== JSON.stringify(this.lastQuery);
                    return hasChanged;
                }),
                takeUntil(this.completed$),
            )
            .subscribe(customFields => {
                const newQuery = addCustomFields(this.lastQuery, this.customFieldMap, customFields);
                this.lastQuery = newQuery;
                const queryRef = this.apollo.watchQuery<T, V>({
                    query: newQuery,
                    variables: this.queryRef.variables,
                    fetchPolicy: this.queryRef.options.fetchPolicy,
                });
                this.queryRef = queryRef;
                this.subscribeToQueryRef(queryRef);
            });
        return this;
    }

    /**
     * @description
     * Returns an Observable which emits a single result and then completes.
     */
    get single$(): Observable<T> {
        return this.currentQueryRefValueChanges.pipe(
            filter(result => result.networkStatus === NetworkStatus.ready),
            take(1),
            map(result => result.data),
            finalize(() => {
                this.completed$.next();
                this.completed$.complete();
            }),
        );
    }

    /**
     * @description
     * Returns an Observable which emits until unsubscribed.
     */
    get stream$(): Observable<T> {
        return this.currentQueryRefValueChanges.pipe(
            filter(result => result.networkStatus === NetworkStatus.ready),
            map(result => result.data),
            finalize(() => {
                this.completed$.next();
                this.completed$.complete();
            }),
        );
    }

    get ref(): QueryRef<T, V> {
        return this.queryRef;
    }

    /**
     * @description
     * Returns a single-result Observable after applying the map function.
     */
    mapSingle<R>(mapFn: (item: T) => R): Observable<R> {
        return this.single$.pipe(map(mapFn));
    }

    /**
     * @description
     * Returns a multiple-result Observable after applying the map function.
     */
    mapStream<R>(mapFn: (item: T) => R): Observable<R> {
        return this.stream$.pipe(map(mapFn));
    }

    /**
     * @description
     * Signals to the internal Observable subscriptions that they should complete.
     */
    destroy() {
        this.completed$.next();
        this.completed$.complete();
    }

    /**
     * @description
     * Returns an Observable which emits the current value of the QueryRef.valueChanges Observable.
     *
     * We wrap the valueChanges Observable in a new Observable so that we can have a lazy
     * evaluation of the valueChanges Observable. That is, we only fire the HTTP request when
     * the returned Observable is subscribed to.
     */
    private get currentQueryRefValueChanges(): Observable<ApolloQueryResult<T>> {
        return new Observable(subscriber => {
            if (!this.queryRefSubscribed.get(this.queryRef)) {
                this.subscribeToQueryRef(this.queryRef);
                this.queryRefSubscribed.set(this.queryRef, true);
            }
            this.valueChangeSubject
                .pipe(startWith(this.queryRef.getCurrentResult()), shareReplay(1))
                .subscribe(subscriber);
            return () => {
                this.queryRefSubscribed.delete(this.queryRef);
            };
        });
    }

    /**
     * @description
     * Subscribes to the valueChanges Observable of the given QueryRef, and stores the subscription
     * so that it can be unsubscribed from when the QueryRef changes.
     */
    private subscribeToQueryRef(queryRef: QueryRef<T, V>) {
        if (this.valueChangesSubscription) {
            this.valueChangesSubscription.unsubscribe();
        }
        this.valueChangesSubscription = queryRef.valueChanges
            .pipe(takeUntil(this.completed$))
            .subscribe(this.valueChangeSubject);
    }
}
