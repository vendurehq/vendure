import { DestroyRef, Directive, inject, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute, QueryParamsHandling, Router } from '@angular/router';
import { ResultOf, TypedDocumentNode, VariablesOf } from '@graphql-typed-document-node/core';
import { BehaviorSubject, combineLatest, merge, Observable, Subject, switchMap } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, map, shareReplay, takeUntil, tap } from 'rxjs/operators';
import { DataService } from '../data/providers/data.service';

import { QueryResult } from '../data/query-result';
import { ServerConfigService } from '../data/server-config';
import { DataTableConfigService } from '../providers/data-table/data-table-config.service';
import { DataTableFilterCollection } from '../providers/data-table/data-table-filter-collection';
import { DataTableSortCollection } from '../providers/data-table/data-table-sort-collection';
import { PermissionsService } from '../providers/permissions/permissions.service';
import { DataTable2ColumnComponent } from '../shared/components/data-table-2/data-table-column.component';
import { DataTableCustomFieldColumnComponent } from '../shared/components/data-table-2/data-table-custom-field-column.component';
import { CustomFieldConfig, CustomFields, LanguageCode } from './generated-types';
import { SelectionManager } from './utilities/selection-manager';

export type ListQueryFn<R> = (take: number, skip: number, ...args: any[]) => QueryResult<R, any>;
export type MappingFn<T, R> = (result: R) => { items: T[]; totalItems: number };
export type OnPageChangeFn<V> = (skip: number, take: number) => V;

/**
 * Unwraps a query that returns a paginated list with an "items" property,
 * returning the type of one of the items in the array.
 */
export type ItemOf<T, K extends keyof T> = T[K] extends { items: infer R }
    ? R extends any[]
        ? R[number]
        : R
    : never;

/**
 * @description
 * This is a base class which implements the logic required to fetch and manipulate
 * a list of data from a query which returns a PaginatedList type.
 *
 * It is normally used in combination with the {@link DataTable2Component}.
 *
 * @docsCategory list-detail-views
 */
@Directive()
// eslint-disable-next-line @angular-eslint/directive-class-suffix
export class BaseListComponent<ResultType, ItemType, VariableType extends Record<string, any> = any>
    implements OnInit, OnDestroy
{
    searchTermControl = new FormControl('');
    selectionManager = new SelectionManager<any>({
        multiSelect: true,
        itemsAreEqual: (a, b) => a.id === b.id,
        additiveMode: true,
    });
    result$: Observable<ResultType>;
    items$: Observable<ItemType[]>;
    totalItems$: Observable<number>;
    itemsPerPage$: Observable<number>;
    currentPage$: Observable<number>;
    protected destroy$ = new Subject<void>();
    private listQuery: QueryResult<ResultType, VariableType>;
    private listQueryFn: ListQueryFn<ResultType>;
    private mappingFn: MappingFn<ItemType, ResultType>;
    private onPageChangeFn: OnPageChangeFn<VariableType> = (skip, take) =>
        ({ options: { skip, take } }) as any;
    protected refresh$ = new BehaviorSubject<undefined>(undefined);
    private defaults: { take: number; skip: number } = { take: 10, skip: 0 };
    protected visibleCustomFieldColumnChange$ = new Subject<
        Array<DataTableCustomFieldColumnComponent<any>>
    >();

    constructor(
        protected router: Router,
        protected route: ActivatedRoute,
    ) {}

    /**
     * @description
     * Sets the fetch function for the list being implemented.
     */
    setQueryFn(
        listQueryFn: ListQueryFn<ResultType>,
        mappingFn: MappingFn<ItemType, ResultType>,
        onPageChangeFn?: OnPageChangeFn<VariableType>,
        defaults?: { take: number; skip: number },
    ) {
        this.listQueryFn = listQueryFn;
        this.mappingFn = mappingFn;
        if (onPageChangeFn) {
            this.onPageChangeFn = onPageChangeFn;
        }
        if (defaults) {
            this.defaults = defaults;
        }
    }

    /** @internal */
    ngOnInit() {
        if (!this.listQueryFn) {
            throw new Error(
                `No listQueryFn has been defined. Please call super.setQueryFn() in the constructor.`,
            );
        }
        this.listQuery = this.listQueryFn(this.defaults.take, this.defaults.skip);

        const fetchPage = ([currentPage, itemsPerPage, _]: [number, number, undefined]) => {
            const take = itemsPerPage;
            const skip = (currentPage - 1) * itemsPerPage;
            this.listQuery.ref?.refetch(this.onPageChangeFn(skip, take));
        };

        this.result$ = this.listQuery.stream$.pipe(shareReplay(1));
        this.items$ = this.result$.pipe(map(data => this.mappingFn(data).items));
        this.totalItems$ = this.result$.pipe(map(data => this.mappingFn(data).totalItems));
        this.currentPage$ = this.route.queryParamMap.pipe(
            map(qpm => qpm.get('page')),
            map(page => (!page ? 1 : +page)),
            distinctUntilChanged(),
        );
        this.itemsPerPage$ = this.route.queryParamMap.pipe(
            map(qpm => qpm.get('perPage')),
            map(perPage => (!perPage ? this.defaults.take : +perPage)),
            distinctUntilChanged(),
        );

        combineLatest(this.currentPage$, this.itemsPerPage$, this.refresh$)
            .pipe(takeUntil(this.destroy$))
            .subscribe(fetchPage);
    }

    /**
     * @description
     * Accepts a list of Observables which will trigger a refresh of the list when any of them emit.
     */
    protected refreshListOnChanges(...streams: Array<Observable<any>>) {
        const searchTerm$ = this.searchTermControl.valueChanges.pipe(
            filter(value => value !== null && (2 < value.length || value.length === 0)),
            debounceTime(250),
            tap(() => this.setPageNumber(1)),
        );

        merge(searchTerm$, ...streams)
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => this.refresh$.next(undefined));
    }

    /** @internal */
    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
        this.listQuery.destroy();
    }

    /**
     * @description
     * Sets the current page number in the url.
     */
    setPageNumber(page: number) {
        this.setQueryParam('page', page, { replaceUrl: true });
    }

    /**
     * @description
     * Sets the number of items per page in the url.
     */
    setItemsPerPage(perPage: number) {
        this.setQueryParam('perPage', perPage, { replaceUrl: true });
    }

    setVisibleColumns(columns: Array<DataTable2ColumnComponent<any>>) {
        this.visibleCustomFieldColumnChange$.next(
            columns.filter(
                (c): c is DataTableCustomFieldColumnComponent<any> =>
                    c instanceof DataTableCustomFieldColumnComponent,
            ),
        );
    }

    /**
     * @description
     * Re-fetch the current page of results.
     */
    refresh() {
        this.refresh$.next(undefined);
    }

    protected setQueryParam(
        hash: { [key: string]: any },
        options?: { replaceUrl?: boolean; queryParamsHandling?: QueryParamsHandling },
    );
    protected setQueryParam(
        key: string,
        value: any,
        options?: { replaceUrl?: boolean; queryParamsHandling?: QueryParamsHandling },
    );
    protected setQueryParam(
        keyOrHash: string | { [key: string]: any },
        valueOrOptions?: any,
        maybeOptions?: { replaceUrl?: boolean; queryParamsHandling?: QueryParamsHandling },
    ) {
        const options = (typeof keyOrHash === 'string' ? maybeOptions : valueOrOptions) ?? {};
        this.router.navigate(['./'], {
            queryParams: typeof keyOrHash === 'string' ? { [keyOrHash]: valueOrOptions } : keyOrHash,
            relativeTo: this.route,
            queryParamsHandling: 'merge',
            ...options,
        });
    }
}

/**
 * @description
 * A version of the {@link BaseListComponent} which is designed to be used with a
 * [TypedDocumentNode](https://the-guild.dev/graphql/codegen/plugins/typescript/typed-document-node).
 *
 * @docsCategory list-detail-views
 */
@Directive()
export class TypedBaseListComponent<
        T extends TypedDocumentNode<any, Vars>,
        Field extends keyof ResultOf<T>,
        Vars extends { options: { filter: any; sort: any } } = VariablesOf<T>,
    >
    extends BaseListComponent<ResultOf<T>, ItemOf<ResultOf<T>, Field>, VariablesOf<T>>
    implements OnInit
{
    availableLanguages$: Observable<LanguageCode[]>;
    contentLanguage$: Observable<LanguageCode>;

    protected dataService = inject(DataService);
    protected router = inject(Router);
    protected serverConfigService = inject(ServerConfigService);
    protected permissionsService = inject(PermissionsService);
    protected dataTableConfigService = inject(DataTableConfigService);
    /**
     * This was introduced to allow us to more easily manage the relation between the
     * DataTableComponent and the BaseListComponent. It allows the base class to
     * correctly look up the currently-visible custom field columns, which can then
     * be passed to the `dataService.query()` method.
     */
    protected dataTableListId: string | undefined;
    private refreshStreams: Array<Observable<any>> = [];
    private collections: Array<DataTableFilterCollection | DataTableSortCollection<any>> = [];

    constructor() {
        super(inject(Router), inject(ActivatedRoute));

        const destroyRef = inject(DestroyRef);
        destroyRef.onDestroy(() => {
            this.collections.forEach(c => c.destroy());
        });
    }

    protected configure(config: {
        document: T;
        getItems: (data: ResultOf<T>) => { items: Array<ItemOf<ResultOf<T>, Field>>; totalItems: number };
        setVariables?: (skip: number, take: number) => VariablesOf<T>;
        refreshListOnChanges?: Array<Observable<any>>;
    }) {
        const customFieldsChange$ = this.visibleCustomFieldColumnChange$.pipe(
            map(columns => columns.map(c => c.customField.name)),
            distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
        );
        const includeCustomFields = this.dataTableListId
            ? this.dataTableConfigService.getConfig(this.dataTableListId).visibility
            : undefined;
        super.setQueryFn(
            (args: any) =>
                this.dataService
                    .query(config.document, {} as any, 'cache-and-network', {
                        includeCustomFields,
                    })
                    .refetchOnChannelChange()
                    .refetchOnCustomFieldsChange(customFieldsChange$),
            data => config.getItems(data),
            (skip, take) => config.setVariables?.(skip, take) ?? ({} as any),
        );
        this.availableLanguages$ = this.serverConfigService.getAvailableLanguages();
        this.contentLanguage$ = this.dataService.client
            .uiState()
            .mapStream(({ uiState }) => uiState.contentLanguage)
            .pipe(tap(() => this.refresh()));
        this.refreshStreams = config.refreshListOnChanges ?? [];
    }

    ngOnInit() {
        super.ngOnInit();
        super.refreshListOnChanges(this.contentLanguage$, ...this.refreshStreams);
    }

    createFilterCollection(): DataTableFilterCollection<NonNullable<NonNullable<Vars['options']>['filter']>> {
        const collection = new DataTableFilterCollection<NonNullable<Vars['options']['filter']>>(this.router);
        this.collections.push(collection);
        return collection;
    }

    createSortCollection(): DataTableSortCollection<NonNullable<NonNullable<Vars['options']>['sort']>> {
        const collection = new DataTableSortCollection<NonNullable<Vars['options']['sort']>>(this.router);
        this.collections.push(collection);
        return collection;
    }

    setLanguage(code: LanguageCode) {
        this.dataService.client.setContentLanguage(code).subscribe();
    }

    getCustomFieldConfig(key: Exclude<keyof CustomFields, '__typename'> | string): CustomFieldConfig[] {
        return this.serverConfigService.getCustomFieldsFor(key).filter(f => {
            if (f.requiresPermission?.length) {
                return this.permissionsService.userHasPermissions(f.requiresPermission);
            }
            return true;
        });
    }
}
