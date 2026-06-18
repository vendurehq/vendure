import { Injectable, OnDestroy } from '@angular/core';
import { ActivatedRoute, Data, NavigationEnd, Params, PRIMARY_OUTLET, Router } from '@angular/router';
import { flatten } from 'lodash';
import {
    combineLatest as observableCombineLatest,
    isObservable,
    Observable,
    of as observableOf,
    Subject,
} from 'rxjs';
import { filter, map, shareReplay, startWith, switchMap, takeUntil } from 'rxjs/operators';
import { DataService } from '../../data/providers/data.service';

export type BreadcrumbString = string;

export interface BreadcrumbLabelLinkPair {
    label: string;
    link: any[];
}

export type BreadcrumbValue = BreadcrumbString | BreadcrumbLabelLinkPair | BreadcrumbLabelLinkPair[];
export type BreadcrumbFunction = (
    data: Data,
    params: Params,
    dataService: DataService,
) => BreadcrumbValue | Observable<BreadcrumbValue>;
export type BreadcrumbDefinition = BreadcrumbValue | BreadcrumbFunction | Observable<BreadcrumbValue>;

@Injectable({
    providedIn: 'root',
})
export class BreadcrumbService implements OnDestroy {
    breadcrumbs$: Observable<Array<{ link: string | any[]; label: string }>>;
    private destroy$ = new Subject<void>();

    constructor(private router: Router, private route: ActivatedRoute, private dataService: DataService) {
        this.breadcrumbs$ = this.router.events.pipe(
            filter(event => event instanceof NavigationEnd),
            takeUntil(this.destroy$),
            startWith(true),
            switchMap(() => this.generateBreadcrumbs(this.route.root)),
            shareReplay(1),
        );
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private generateBreadcrumbs(
        rootRoute: ActivatedRoute,
    ): Observable<Array<{ link: Array<string | any>; label: string }>> {
        const breadcrumbParts = this.assembleBreadcrumbParts(rootRoute);
        const breadcrumbObservables$ = breadcrumbParts.map(
            ({ value$, path }) =>
                value$.pipe(
                    map(value => {
                        if (isBreadcrumbLabelLinkPair(value)) {
                            return {
                                label: value.label,
                                link: this.normalizeRelativeLinks(value.link, path),
                            };
                        } else if (isBreadcrumbPairArray(value)) {
                            return value.map(val => ({
                                label: val.label,
                                link: this.normalizeRelativeLinks(val.link, path),
                            }));
                        } else {
                            return {
                                label: value,
                                link: '/' + path.join('/'),
                            };
                        }
                    }),
                ) as Observable<BreadcrumbLabelLinkPair | BreadcrumbLabelLinkPair[]>,
        );

        return observableCombineLatest(breadcrumbObservables$).pipe(map(links => flatten(links)));
    }

    /**
     * Walks the route definition tree to assemble an array from which the breadcrumbs can be derived.
     */
    private assembleBreadcrumbParts(
        rootRoute: ActivatedRoute,
    ): Array<{ value$: Observable<BreadcrumbValue>; path: string[] }> {
        const breadcrumbParts: Array<{ value$: Observable<BreadcrumbValue>; path: string[] }> = [];
        const segmentPaths: string[] = [];
        let currentRoute: ActivatedRoute | null = rootRoute;
        do {
            const childRoutes = currentRoute.children;
            currentRoute = null;
            childRoutes.forEach((route: ActivatedRoute) => {
                if (route.outlet === PRIMARY_OUTLET) {
                    const routeSnapshot = route.snapshot;
                    let breadcrumbDef: BreadcrumbDefinition | undefined =
                        route.routeConfig && route.routeConfig.data && route.routeConfig.data['breadcrumb'];
                    segmentPaths.push(routeSnapshot.url.map(segment => segment.path).join('/'));

                    if (breadcrumbDef) {
                        if (isBreadcrumbFunction(breadcrumbDef)) {
                            breadcrumbDef = breadcrumbDef(
                                routeSnapshot.data,
                                routeSnapshot.params,
                                this.dataService,
                            );
                        }
                        const observableValue = isObservable(breadcrumbDef)
                            ? breadcrumbDef
                            : observableOf(breadcrumbDef);
                        breadcrumbParts.push({ value$: observableValue, path: segmentPaths.slice() });
                    }
                    currentRoute = route;
                }
            });
        } while (currentRoute);

        return breadcrumbParts;
    }

    /**
     * Accounts for relative routes in the link array, i.e. arrays whose first element is either:
     * * `./`   - this appends the rest of the link segments to the current active route
     * * `../`  - this removes the last segment of the current active route, and appends the link segments
     *            to the parent route.
     */
    private normalizeRelativeLinks(link: any[], segmentPaths: string[]): any[] {
        const clone = link.slice();
        if (clone[0] === './') {
            clone[0] = segmentPaths.join('/');
        }
        if (clone[0] === '../') {
            clone[0] = segmentPaths.slice(0, -1).join('/');
        }
        return clone.filter(segment => segment !== '');
    }
}

function isBreadcrumbFunction(value: BreadcrumbDefinition): value is BreadcrumbFunction {
    return typeof value === 'function';
}

function isBreadcrumbLabelLinkPair(value: BreadcrumbValue): value is BreadcrumbLabelLinkPair {
    return value.hasOwnProperty('label') && value.hasOwnProperty('link');
}

function isBreadcrumbPairArray(value: BreadcrumbValue): value is BreadcrumbLabelLinkPair[] {
    return Array.isArray(value) && isBreadcrumbLabelLinkPair(value[0]);
}
