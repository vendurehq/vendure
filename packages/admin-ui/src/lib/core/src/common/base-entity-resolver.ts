import {
    ActivatedRouteSnapshot,
    ActivationStart,
    ResolveData,
    Router,
    RouterStateSnapshot,
} from '@angular/router';
import { Type } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { Observable, of } from 'rxjs';
import { filter, map, shareReplay, take, takeUntil } from 'rxjs/operators';

export interface EntityResolveData<R> extends ResolveData {
    entity: Type<BaseEntityResolver<R>>;
}

export function createResolveData<T extends BaseEntityResolver<R>, R>(
    resolver: Type<T>,
): EntityResolveData<R> {
    return {
        entity: resolver,
    };
}

/**
 * @description
 * A base resolver for an entity detail route. Resolves to an observable of the given entity, or a "blank"
 * version if the route id equals "create". Should be used together with details views which extend the
 * {@link BaseDetailComponent}.
 *
 * @example
 * ```ts
 * \@Injectable({
 *   providedIn: 'root',
 * })
 * export class MyEntityResolver extends BaseEntityResolver<MyEntityFragment> {
 *   constructor(router: Router, dataService: DataService) {
 *     super(
 *       router,
 *       {
 *         __typename: 'MyEntity',
 *         id: '',
 *         createdAt: '',
 *         updatedAt: '',
 *         name: '',
 *       },
 *       id => dataService.query(GET_MY_ENTITY, { id }).mapStream(data => data.myEntity),
 *     );
 *   }
 * }
 * ```
 *
 * @docsCategory list-detail-views
 */
export class BaseEntityResolver<T> {
    constructor(
        protected router: Router,
        private readonly emptyEntity: T,
        private entityStream: (id: string) => Observable<T | null | undefined>,
    ) {}

    /** @internal */
    resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<Observable<T>> {
        const id = route.paramMap.get('id');

        // Complete the entity stream upon navigating away
        const navigateAway$ = this.router.events.pipe(filter(event => event instanceof ActivationStart));

        if (id === 'create') {
            return of(of(this.emptyEntity));
        } else {
            const stream = this.entityStream(id || '').pipe(
                takeUntil(navigateAway$),
                filter(notNullOrUndefined),
                shareReplay(1),
            );

            return stream.pipe(
                take(1),
                map(() => stream),
            );
        }
    }
}
