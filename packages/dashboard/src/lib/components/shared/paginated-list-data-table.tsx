import { DataTable, FacetedFilter } from '@/vdb/components/data-table/data-table.js';
import { getObjectPathToPaginatedList } from '@/vdb/framework/document-introspection/get-document-structure.js';
import { useListQueryFields } from '@/vdb/framework/document-introspection/hooks.js';
import { api } from '@/vdb/graphql/api.js';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';

import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { includeOnlySelectedListFields } from '@/vdb/framework/document-introspection/include-only-selected-list-fields.js';
import { BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useExtendedListQuery } from '@/vdb/hooks/use-extended-list-query.js';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { ColumnFiltersState, ColumnSort, SortingState, Table } from '@tanstack/react-table';
import { ColumnDef, Row, TableOptions, VisibilityState } from '@tanstack/table-core';
import React from 'react';
import { getColumnVisibility, getStandardizedDefaultColumnOrder } from '../data-table/data-table-utils.js';
import { useGeneratedColumns } from '../data-table/use-generated-columns.js';
import { PaginatedListContext } from './paginated-list-context.js';

// Type that identifies a paginated list structure (has items array and totalItems)
type IsPaginatedList<T> = T extends { items: any[]; totalItems: number } ? true : false;

// Helper type to extract string keys from an object
type StringKeys<T> = T extends object ? Extract<keyof T, string> : never;

// Non-recursive approach to find paginated list paths with max 2 levels
// Level 0: Direct top-level check
type Level0PaginatedLists<T> = T extends object ? (IsPaginatedList<T> extends true ? '' : never) : never;

// Level 1: One level deep
type Level1PaginatedLists<T> = T extends object
    ? {
          [K in StringKeys<T>]: NonNullable<T[K]> extends object
              ? IsPaginatedList<NonNullable<T[K]>> extends true
                  ? K
                  : never
              : never;
      }[StringKeys<T>]
    : never;

// Level 2: Two levels deep
type Level2PaginatedLists<T> = T extends object
    ? {
          [K1 in StringKeys<T>]: NonNullable<T[K1]> extends object
              ? {
                    [K2 in StringKeys<NonNullable<T[K1]>>]: NonNullable<NonNullable<T[K1]>[K2]> extends object
                        ? IsPaginatedList<NonNullable<NonNullable<T[K1]>[K2]>> extends true
                            ? `${K1}.${K2}`
                            : never
                        : never;
                }[StringKeys<NonNullable<T[K1]>>]
              : never;
      }[StringKeys<T>]
    : never;

// Combine all levels
type FindPaginatedListPaths<T> = Level0PaginatedLists<T> | Level1PaginatedLists<T> | Level2PaginatedLists<T>;

// Extract all paths from a TypedDocumentNode
export type PaginatedListPaths<T extends TypedDocumentNode<any, any>> =
    FindPaginatedListPaths<ResultOf<T>> extends infer Paths ? (Paths extends '' ? never : Paths) : never;

export type PaginatedListItemFields<
    T extends TypedDocumentNode<any, any>,
    Path extends PaginatedListPaths<T> = PaginatedListPaths<T>,
> =
    // split the path by '.' if it exists
    Path extends `${infer First}.${infer Rest}`
        ? NonNullable<ResultOf<T>[First]>[Rest]['items'][number]
        : Path extends keyof ResultOf<T>
          ? ResultOf<T>[Path] extends { items: Array<infer Item> }
              ? ResultOf<T>[Path]['items'][number]
              : never
          : never;

export type PaginatedListKeys<
    T extends TypedDocumentNode<any, any>,
    Path extends PaginatedListPaths<T> = PaginatedListPaths<T>,
> = {
    [K in keyof PaginatedListItemFields<T, Path>]: K;
}[keyof PaginatedListItemFields<T, Path>];

// Utility types to include keys inside `customFields` object for typing purposes
export type CustomFieldKeysOfItem<Item> = Item extends { customFields?: infer CF }
    ? Extract<keyof CF, string>
    : never;

export type AllItemFieldKeys<T extends TypedDocumentNode<any, any>> =
    | keyof PaginatedListItemFields<T>
    | CustomFieldKeysOfItem<PaginatedListItemFields<T>>;

export type ColumnDefWithMetaDependencies<T extends TypedDocumentNode<any, any>> = Partial<
    ColumnDef<T, any>
> & {
    meta?: {
        /**
         * @description
         * If true, the column will not be displayed in the table.
         */
        disabled?: boolean;
        /**
         * @description
         * Columns that rely on _other_ columns in order to correctly render,
         * can declare those other columns as dependencies in order to ensure that
         * those columns are always fetched, even when those columns are not explicitly
         * included in the visible table columns.
         */
        dependencies?: Array<AllItemFieldKeys<T>>;
    };
};

export type CustomizeColumnConfig<T extends TypedDocumentNode<any, any>> = {
    [Key in AllItemFieldKeys<T>]?: ColumnDefWithMetaDependencies<PaginatedListItemFields<T>>;
};

export type FacetedFilterConfig<T extends TypedDocumentNode<any, any>> = {
    [Key in AllItemFieldKeys<T> | (string & {})]?: FacetedFilter;
};

export type ListQueryFields<T extends TypedDocumentNode<any, any>> = {
    [Key in keyof ResultOf<T>]: ResultOf<T>[Key] extends { items: infer U }
        ? U extends any[]
            ? U[number]
            : never
        : never;
}[keyof ResultOf<T>];

export type ListQueryShape =
    | {
          [key: string]: {
              items: any[];
              totalItems: number;
          };
      }
    | {
          [key: string]: {
              [key: string]: {
                  items: any[];
                  totalItems: number;
              };
          };
      };

export type ListQueryOptionsShape = {
    options?: {
        skip?: number;
        take?: number;
        sort?: {
            [key: string]: 'ASC' | 'DESC';
        };
        filter?: any;
    };
    [key: string]: any;
};

export type AdditionalColumns<T extends TypedDocumentNode<any, any>> = {
    [key: string]: ColumnDefWithMetaDependencies<PaginatedListItemFields<T>>;
};

export interface RowAction<T> {
    label: React.ReactNode;
    onClick?: (row: Row<T>) => void;
}

export type PaginatedListRefresherRegisterFn = (refreshFn: () => void) => void;

/**
 * @description
 * Props to configure the {@link PaginatedListDataTable} component.
 *
 * @docsCategory list-views
 * @docsPage PaginatedListDataTable
 * @since 3.4.0
 */
export interface PaginatedListDataTableProps<
    T extends TypedDocumentNode<U, V>,
    U extends ListQueryShape,
    V extends ListQueryOptionsShape,
    AC extends AdditionalColumns<T>,
> {
    listQuery: T;
    deleteMutation?: TypedDocumentNode<any, any>;
    transformQueryKey?: (queryKey: any[]) => any[];
    transformVariables?: (variables: V) => V;
    customizeColumns?: CustomizeColumnConfig<T>;
    additionalColumns?: AC;
    defaultColumnOrder?: (keyof ListQueryFields<T> | keyof AC | CustomFieldKeysOfItem<ListQueryFields<T>>)[];
    defaultVisibility?: Partial<Record<AllItemFieldKeys<T>, boolean>>;
    /**
     * @description
     * Called whenever the debounced search term changes (including when it
     * becomes empty). Return a partial filter to merge with the column /
     * faceted filters. The returned filter is only applied when the term is
     * non-empty — when the term is `''`, the returned value is discarded so
     * that callers can write `{ field: { contains: searchTerm } }` without
     * producing tautological `contains: ''` clauses. The callback itself is
     * still invoked on every change so pages can use it as a state-sync hook.
     */
    onSearchTermChange?: (searchTerm: string) => NonNullable<V['options']>['filter'];
    page: number;
    itemsPerPage: number;
    sorting: SortingState;
    columnFilters?: ColumnFiltersState;
    onPageChange: (table: Table<any>, page: number, perPage: number) => void;
    onSortChange: (table: Table<any>, sorting: SortingState) => void;
    onFilterChange: (table: Table<any>, filters: ColumnFiltersState) => void;
    onColumnVisibilityChange?: (table: Table<any>, columnVisibility: VisibilityState) => void;
    facetedFilters?: FacetedFilterConfig<T>;
    rowActions?: RowAction<PaginatedListItemFields<T>>[];
    bulkActions?: BulkActionsInput;
    disableViewOptions?: boolean;
    transformData?: (data: PaginatedListItemFields<T>[]) => PaginatedListItemFields<T>[];
    setTableOptions?: (table: TableOptions<any>) => TableOptions<any>;
    /**
     * Register a function that allows you to assign a refresh function for
     * this list. The function can be assigned to a ref and then called when
     * the list needs to be refreshed.
     */
    registerRefresher?: PaginatedListRefresherRegisterFn;
    /**
     * @description
     * Callback when items are reordered via drag and drop.
     * When provided, enables drag-and-drop functionality.
     */
    onReorder?: (
        oldIndex: number,
        newIndex: number,
        item: PaginatedListItemFields<T>,
    ) => void | Promise<void>;
    /**
     * @description
     * When true, drag and drop will be disabled. This will only have an effect if the onReorder prop is also set
     */
    disableDragAndDrop?: boolean;
    /**
     * @description
     * When false, the row selection checkbox column will not be included.
     *
     * @default true
     */
    includeSelectionColumn?: boolean;
}

export const PaginatedListDataTableKey = 'PaginatedListDataTable';

/**
 * @description
 * A wrapper around the {@link DataTable} component, which automatically configures functionality common to
 * list queries that implement the `PaginatedList` interface, which is the common way of representing lists
 * of data in Vendure.
 *
 * Given a GraphQL query document node, the component will automatically configure the required columns
 * with sorting & filtering functionality.
 *
 * The automatic features can be further customized and enhanced using the many options available in the props.
 *
 * @example
 * ```tsx
 * import { Money } from '\@/vdb/components/data-display/money.js';
 * import { PaginatedListDataTable } from '\@/vdb/components/shared/paginated-list-data-table.js';
 * import { Badge } from '\@/vdb/components/ui/badge.js';
 * import { Button } from '\@/vdb/components/ui/button.js';
 * import { Link } from '\@tanstack/react-router';
 * import { ColumnFiltersState, SortingState } from '\@tanstack/react-table';
 * import { useState } from 'react';
 * import { customerOrderListDocument } from '../customers.graphql.js';
 *
 * interface CustomerOrderTableProps {
 *     customerId: string;
 * }
 *
 * export function CustomerOrderTable({ customerId }: Readonly<CustomerOrderTableProps>) {
 *     const [page, setPage] = useState(1);
 *     const [pageSize, setPageSize] = useState(10);
 *     const [sorting, setSorting] = useState<SortingState>([{ id: 'orderPlacedAt', desc: true }]);
 *     const [filters, setFilters] = useState<ColumnFiltersState>([]);
 *
 *     return (
 *         <PaginatedListDataTable
 *             listQuery={customerOrderListDocument}
 *             transformVariables={variables => {
 *                 return {
 *                     ...variables,
 *                     customerId,
 *                 };
 *             }}
 *             defaultVisibility={{
 *                 id: false,
 *                 createdAt: false,
 *                 updatedAt: false,
 *                 type: false,
 *                 currencyCode: false,
 *                 total: false,
 *             }}
 *             customizeColumns={{
 *                 total: {
 *                     header: 'Total',
 *                     cell: ({ cell, row }) => {
 *                         const value = cell.getValue();
 *                         const currencyCode = row.original.currencyCode;
 *                         return <Money value={value} currency={currencyCode} />;
 *                     },
 *                 },
 *                 totalWithTax: {
 *                     header: 'Total with Tax',
 *                     cell: ({ cell, row }) => {
 *                         const value = cell.getValue();
 *                         const currencyCode = row.original.currencyCode;
 *                         return <Money value={value} currency={currencyCode} />;
 *                     },
 *                 },
 *                 state: {
 *                     header: 'State',
 *                     cell: ({ cell }) => {
 *                         const value = cell.getValue() as string;
 *                         return <Badge variant="outline">{value}</Badge>;
 *                     },
 *                 },
 *                 code: {
 *                     header: 'Code',
 *                     cell: ({ cell, row }) => {
 *                         const value = cell.getValue() as string;
 *                         const id = row.original.id;
 *                         return (
 *                             <Button variant="ghost" render={<Link to={`/orders/${id}`} />}>
 *                                 {value}
 *                             </Button>
 *                         );
 *                     },
 *                 },
 *             }}
 *             page={page}
 *             itemsPerPage={pageSize}
 *             sorting={sorting}
 *             columnFilters={filters}
 *             onPageChange={(_, page, perPage) => {
 *                 setPage(page);
 *                 setPageSize(perPage);
 *             }}
 *             onSortChange={(_, sorting) => {
 *                 setSorting(sorting);
 *             }}
 *             onFilterChange={(_, filters) => {
 *                 setFilters(filters);
 *             }}
 *         />
 *     );
 * }
 * ```
 *
 * @docsCategory list-views
 * @docsPage PaginatedListDataTable
 * @since 3.4.0
 * @docsWeight 0
 */
export function PaginatedListDataTable<
    T extends TypedDocumentNode<U, V>,
    U extends Record<string, any> = any,
    V extends ListQueryOptionsShape = any,
    AC extends AdditionalColumns<T> = AdditionalColumns<T>,
>({
    listQuery,
    deleteMutation,
    transformQueryKey,
    transformVariables,
    customizeColumns,
    additionalColumns,
    defaultVisibility,
    defaultColumnOrder,
    onSearchTermChange,
    page,
    itemsPerPage,
    sorting,
    columnFilters,
    onPageChange,
    onSortChange,
    onFilterChange,
    onColumnVisibilityChange,
    facetedFilters,
    rowActions,
    bulkActions,
    disableViewOptions,
    setTableOptions,
    transformData,
    registerRefresher,
    onReorder,
    disableDragAndDrop = false,
    includeSelectionColumn,
}: Readonly<PaginatedListDataTableProps<T, U, V, AC>>) {
    const [searchTerm, setSearchTerm] = React.useState<string>('');
    const debouncedSearchTerm = useDebounce(searchTerm, 500);
    const queryClient = useQueryClient();
    const extendedListQuery = useExtendedListQuery(addCustomFields(listQuery));

    const sort = sorting?.reduce((acc: any, sort: ColumnSort) => {
        const direction = sort.desc ? 'DESC' : 'ASC';
        const field = sort.id;

        if (!field || !direction) {
            return acc;
        }
        return { ...acc, [field]: direction };
    }, {});

    function refetchPaginatedList() {
        queryClient.invalidateQueries({ queryKey });
    }

    registerRefresher?.(refetchPaginatedList);

    // First we get info on _all_ the fields, including all custom fields, for the
    // purpose of configuring the table columns.
    const fields = useListQueryFields(extendedListQuery);
    const paginatedListObjectPath = getObjectPathToPaginatedList(extendedListQuery);

    const { columns, customFieldColumnNames } = useGeneratedColumns({
        fields,
        customizeColumns,
        rowActions,
        bulkActions,
        deleteMutation,
        additionalColumns,
        defaultColumnOrder: getStandardizedDefaultColumnOrder(defaultColumnOrder),
        includeSelectionColumn,
    });
    const columnVisibility = getColumnVisibility(columns, defaultVisibility, customFieldColumnNames);
    // Get the actual visible columns and only fetch those
    const visibleColumns = columns
        // Filter out invisible columns, but _always_ select "id"
        // because it is usually needed.
        .filter(c => columnVisibility[c.id as string] !== false || c.id === 'id')
        .map(c => ({
            name: c.id as string,
            isCustomField: (c.meta as any)?.isCustomField ?? false,
            dependencies: (c.meta as any)?.dependencies ?? [],
        }));
    const minimalListQuery = includeOnlySelectedListFields(extendedListQuery, visibleColumns);

    const filter = columnFilters?.length
        ? {
              _and: columnFilters.map(f => {
                  if (Array.isArray(f.value)) {
                      return { [f.id]: { in: f.value } };
                  }
                  return { [f.id]: f.value };
              }),
          }
        : undefined;

    const defaultQueryKey = [
        PaginatedListDataTableKey,
        minimalListQuery,
        visibleColumns,
        page,
        itemsPerPage,
        sorting,
        filter,
        debouncedSearchTerm,
    ];
    const queryKey = transformQueryKey ? transformQueryKey(defaultQueryKey) : defaultQueryKey;

    const { data, isFetching } = useQuery({
        queryFn: () => {
            // Always invoke onSearchTermChange so callers can use it as a
            // state-sync hook (e.g. collections.tsx gates drag-and-drop on the
            // current search term). Discard its filter contribution when the
            // term is empty — otherwise pages built around
            // `contains: searchTerm` produce `contains: ''` clauses that match
            // everything, and combined with `filterOperator: 'OR'` they
            // silently disable all column filters.
            const rawSearchFilter = onSearchTermChange ? onSearchTermChange(debouncedSearchTerm) : {};
            const searchFilter = debouncedSearchTerm ? rawSearchFilter : {};
            const mergedFilter = { ...filter, ...searchFilter };
            const variables = {
                options: {
                    take: Math.min(itemsPerPage, 100),
                    skip: (page - 1) * itemsPerPage,
                    sort,
                    filter: mergedFilter,
                },
            } as V;

            const transformedVariables = transformVariables ? transformVariables(variables) : variables;
            return api.query(minimalListQuery, transformedVariables);
        },
        queryKey,
        placeholderData: keepPreviousData,
    });
    let listData = data as any;
    for (const path of paginatedListObjectPath) {
        listData = listData?.[path];
    }

    const transformedData =
        typeof transformData === 'function' ? transformData(listData?.items ?? []) : (listData?.items ?? []);
    return (
        <PaginatedListContext.Provider value={{ refetchPaginatedList }}>
            <DataTable
                columns={columns}
                data={transformedData}
                isLoading={isFetching}
                page={page}
                itemsPerPage={itemsPerPage}
                sorting={sorting}
                columnFilters={columnFilters}
                totalItems={listData?.totalItems ?? 0}
                onPageChange={onPageChange}
                onSortChange={onSortChange}
                onFilterChange={onFilterChange}
                onColumnVisibilityChange={onColumnVisibilityChange}
                onSearchTermChange={onSearchTermChange ? term => setSearchTerm(term) : undefined}
                defaultColumnVisibility={columnVisibility}
                facetedFilters={facetedFilters}
                disableViewOptions={disableViewOptions}
                bulkActions={bulkActions}
                setTableOptions={setTableOptions}
                onRefresh={refetchPaginatedList}
                onReorder={onReorder}
                disableDragAndDrop={disableDragAndDrop}
            />
        </PaginatedListContext.Provider>
    );
}
