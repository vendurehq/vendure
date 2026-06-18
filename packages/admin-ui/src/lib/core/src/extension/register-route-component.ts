import { Type } from '@angular/core';
import { ResolveFn, Route } from '@angular/router';
import { ResultOf, TypedDocumentNode } from '@graphql-typed-document-node/core';
import { DocumentNode } from 'graphql';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { BaseDetailComponent, createBaseDetailResolveFn } from '../common/base-detail.component';
import { BreadcrumbValue } from '../providers/breadcrumb/breadcrumb.service';
import { AngularRouteComponent } from './components/angular-route.component';
import { ROUTE_COMPONENT_OPTIONS } from './components/route.component';
import { RouteComponentOptions } from './types';

/**
 * @description
 * Configuration for a route component.
 *
 * @docsCategory routes
 */
export type RegisterRouteComponentOptions<
    Component extends any | BaseDetailComponent<Entity>,
    Entity extends { id: string; updatedAt?: string },
    T extends DocumentNode | TypedDocumentNode<any, { id: string }>,
    Field extends keyof ResultOf<T>,
    R extends Field,
> = {
    component: Type<Component> | Component;
    title?: string;
    locationId?: string;
    description?: string;
    breadcrumb?: BreadcrumbValue;
    path?: string;
    query?: T;
    getBreadcrumbs?: (entity: Exclude<ResultOf<T>[R], 'Query'>) => BreadcrumbValue;
    entityKey?: Component extends BaseDetailComponent<any> ? R : string;
    variables?: T extends TypedDocumentNode<any, infer V> ? Omit<V, 'id'> : never;
    routeConfig?: Route;
} & (Component extends BaseDetailComponent<any> ? { entityKey: R } : unknown);

/**
 * @description
 * Registers an Angular standalone component to be rendered in a route.
 *
 * @example
 * ```ts title="routes.ts"
 * import { registerRouteComponent } from '\@vendure/admin-ui/core';
 * import { registerReactRouteComponent } from '\@vendure/admin-ui/react';
 *
 * import { ProductReviewDetailComponent } from './components/product-review-detail/product-review-detail.component';
 * import { AllProductReviewsList } from './components/all-product-reviews-list/all-product-reviews-list.component';
 * import { GetReviewDetailDocument } from './generated-types';
 *
 * export default [
 *     registerRouteComponent({
 *         path: '',
 *         component: AllProductReviewsList,
 *         breadcrumb: 'Product reviews',
 *     }),
 *     registerRouteComponent({
 *         path: ':id',
 *         component: ProductReviewDetailComponent,
 *         query: GetReviewDetailDocument,
 *         entityKey: 'productReview',
 *         getBreadcrumbs: entity => [
 *             {
 *                 label: 'Product reviews',
 *                 link: ['/extensions', 'product-reviews'],
 *             },
 *             {
 *                 label: `#${entity?.id} (${entity?.product.name})`,
 *                 link: [],
 *             },
 *         ],
 *     }),
 * ];
 * ```
 *
 * @docsCategory routes
 */
export function registerRouteComponent<
    Component extends any | BaseDetailComponent<Entity>,
    Entity extends { id: string; updatedAt?: string },
    T extends DocumentNode | TypedDocumentNode<any, { id: string }>,
    Field extends keyof ResultOf<T>,
    R extends Field,
>(options: RegisterRouteComponentOptions<Component, Entity, T, Field, R>) {
    const { query, entityKey, variables, getBreadcrumbs, locationId, description } = options;

    const breadcrumbSubject$ = new BehaviorSubject<BreadcrumbValue>(options.breadcrumb ?? '');
    const titleSubject$ = new BehaviorSubject<string | undefined>(options.title);

    if (getBreadcrumbs != null && (query == null || entityKey == null)) {
        console.error(
            [
                `[${
                    options.path ?? 'custom'
                } route] When using the "getBreadcrumbs" option, the "query" and "entityKey" options must also be provided.`,
                ``,
                `Alternatively, use the "breadcrumb" option instead, or use the "PageMetadataService" inside your Angular component`,
                `or the "usePageMetadata" React hook to set the breadcrumb.`,
            ].join('\n'),
        );
    }

    const resolveFn:
        | ResolveFn<{
              entity: Observable<ResultOf<T>[Field] | null>;
              result?: ResultOf<T>;
          }>
        | undefined =
        query && entityKey
            ? createBaseDetailResolveFn({
                  query,
                  entityKey,
                  variables,
              })
            : undefined;

    return {
        path: options.path ?? '',
        providers: [
            {
                provide: ROUTE_COMPONENT_OPTIONS,
                useValue: {
                    component: options.component,
                    title$: titleSubject$,
                    breadcrumb$: breadcrumbSubject$,
                } satisfies RouteComponentOptions,
            },
            ...(options.routeConfig?.providers ?? []),
        ],
        ...(options.routeConfig ?? {}),
        resolve: { ...(resolveFn ? { detail: resolveFn } : {}), ...(options.routeConfig?.resolve ?? {}) },
        data: {
            locationId,
            description,
            breadcrumb: breadcrumbSubject$,
            ...(options.routeConfig?.data ?? {}),
            ...(getBreadcrumbs && query && entityKey
                ? {
                      breadcrumb: data =>
                          data.detail.entity.pipe(map((entity: any) => getBreadcrumbs(entity))),
                  }
                : {}),
            ...(options.routeConfig?.data ?? {}),
        },
        component: AngularRouteComponent,
    } satisfies Route;
}
