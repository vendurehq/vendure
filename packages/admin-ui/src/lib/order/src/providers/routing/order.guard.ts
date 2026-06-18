import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { DataService, GetOrderStateQuery, GetOrderStateQueryVariables } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export const GET_ORDER_STATE = gql`
    query GetOrderState($id: ID!) {
        order(id: $id) {
            id
            state
        }
    }
`;

@Injectable({
    providedIn: 'root',
})
export class OrderGuard {
    constructor(private dataService: DataService, private router: Router) {}

    canActivate(
        route: ActivatedRouteSnapshot,
        state: RouterStateSnapshot,
    ): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
        const isDraft = state.url.includes('orders/draft');
        const isModifying = state.url.includes('/modify');
        const id = route.paramMap.get('id');
        if (isDraft) {
            if (id === 'create') {
                return this.dataService.order
                    .createDraftOrder()
                    .pipe(
                        map(({ createDraftOrder }) =>
                            this.router.parseUrl(`/orders/draft/${createDraftOrder.id}`),
                        ),
                    );
            } else {
                return true;
            }
        } else {
            return (
                this.dataService
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    .query<GetOrderStateQuery, GetOrderStateQueryVariables>(GET_ORDER_STATE, { id: id! })
                    .single$.pipe(
                        map(({ order }) => {
                            if (order?.state === 'Modifying' && !isModifying) {
                                return this.router.parseUrl(`/orders/${id}/modify`);
                            } else {
                                return true;
                            }
                        }),
                    )
            );
        }
    }
}
