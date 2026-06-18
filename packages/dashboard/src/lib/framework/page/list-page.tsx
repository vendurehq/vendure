import {
    AdditionalColumns,
    CustomFieldKeysOfItem,
    CustomizeColumnConfig,
    FacetedFilterConfig,
    ListQueryFields,
    ListQueryOptionsShape,
    ListQueryShape,
    PaginatedListDataTable,
    PaginatedListRefresherRegisterFn,
    RowAction,
} from '@/vdb/components/shared/paginated-list-data-table.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { AnyRoute, AnyRouter, useNavigate } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState, Table } from '@tanstack/react-table';
import { TableOptions } from '@tanstack/table-core';

import { BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import {
    FullWidthPageBlock,
    Page,
    PageActionBar,
    PageLayout,
    PageTitle,
} from '../layout-engine/page-layout.js';

/**
 * @description
 * Props to configure the {@link ListPage} component.
 *
 * @docsCategory list-views
 * @docsPage ListPage
 * @since 3.3.0
 */
export interface ListPageProps<
    T extends TypedDocumentNode<U, V>,
    U extends ListQueryShape,
    V extends ListQueryOptionsShape,
    AC extends AdditionalColumns<T>,
> {
    /**
     * @description
     * A unique identifier for the list page. This is important to support
     * customization functionality that relies on page IDs and makes your
     * component extensible.
     */
    pageId?: string;
    /**
     @description
     * The Tanstack Router `Route` object, which will be defined in the component file.
     */
    route: AnyRoute | (() => AnyRoute);
    /**
     @description
     * The page title, which will display in the header area.
     */
    title: string | React.ReactElement;
    /**
     * @description
     * This DocumentNode of the list query, i.e. a query that fetches
     * PaginatedList data with "items" and "totalItems", such as:
     *
     * @example
     * ```tsx
     * export const collectionListDocument = graphql(`
     *   query CollectionList($options: CollectionListOptions) {
     *     collections(options: $options) {
     *       items {
     *         id
     *         createdAt
     *         updatedAt
     *         name
     *         slug
     *         breadcrumbs {
     *           id
     *           name
     *           slug
     *         }
     *         children {
     *           id
     *           name
     *         }
     *         # ... etc
     *       }
     *       totalItems
     *     }
     *   }
     * `);
     * // ...
     * <ListPage
     *   pageId="collection-list"
     *   listQuery={collectionListDocument}
     *   // ...
     * />
     * ```
     */
    listQuery: T;
    /**
     * @description
     * Providing the `deleteMutation` will automatically add a "delete" menu item to the
     * actions column dropdown. Note that if this table already has a "delete" bulk action,
     * you don't need to additionally provide a delete mutation, because the bulk action
     * will be added to the action column dropdown already.
     */
    deleteMutation?: TypedDocumentNode<any, { id: string }>;
    /**
     * @description
     * This prop can be used to intercept and transform the list query variables before they are
     * sent to the Admin API.
     *
     * This allows you to implement specific logic that differs from the standard filter/sort
     * handling.
     *
     * @example
     * ```tsx
     * <ListPage
     *   pageId="collection-list"
     *   title="Collections"
     *   listQuery={collectionListDocument}
     *   transformVariables={input => {
     *       const filterTerm = input.options?.filter?.name?.contains;
     *       // If there is a filter term set
     *       // we want to return all results. Else
     *       // we only want top-level Collections
     *       const isFiltering = !!filterTerm;
     *       return {
     *           options: {
     *               ...input.options,
     *               topLevelOnly: !isFiltering,
     *           },
     *       };
     *   }}
     * />
     * ```
     */
    transformVariables?: (variables: V) => V;
    /**
     * @description
     * Allows you to customize how the search term is used in the list query options.
     * For instance, when you want the term to filter on specific fields.
     *
     * @example
     * ```tsx
     *  <ListPage
     *    pageId="administrator-list"
     *    title="Administrators"
     *    listQuery={administratorListDocument}
     *    onSearchTermChange={searchTerm => {
     *      return {
     *        firstName: { contains: searchTerm },
     *        lastName: { contains: searchTerm },
     *        emailAddress: { contains: searchTerm },
     *      };
     *    }}
     *  />
     * ```
     * @param searchTerm
     */
    onSearchTermChange?: (searchTerm: string) => NonNullable<V['options']>['filter'];
    /**
     * @description
     * Allows you to customize the rendering and other aspects of individual columns.
     *
     * By default, an appropriate component will be chosen to render the column data
     * based on the data type of the field. However, in many cases you want to have
     * more control over how the column data is rendered.
     *
     * @example
     * ```tsx
     * <ListPage
     *   pageId="collection-list"
     *   listQuery={collectionListDocument}
     *   customizeColumns={{
     *     // The key "name" matches one of the top-level fields of the
     *     // list query type (Collection, in this example)
     *     name: {
     *       meta: {
     *           // The Dashboard optimizes the list query `collectionListDocument` to
     *           // only select field that are actually visible in the ListPage table.
     *           // However, sometimes you want to render data from other fields, i.e.
     *           // this column has a data dependency on the "children" and "breadcrumbs"
     *           // fields in order to correctly render the "name" field.
     *           // In this case, we can declare those data dependencies which means whenever
     *           // the "name" column is visible, it will ensure the "children" and "breadcrumbs"
     *           // fields are also selected in the query.
     *           dependencies: ['children', 'breadcrumbs'],
     *       },
     *       header: 'Collection Name',
     *       cell: ({ row }) => {
     *         const isExpanded = row.getIsExpanded();
     *         const hasChildren = !!row.original.children?.length;
     *         return (
     *           <div
     *             style={{ marginLeft: (row.original.breadcrumbs?.length - 2) * 20 + 'px' }}
     *             className="flex gap-2 items-center"
     *           >
     *             <Button
     *               size="icon"
     *               variant="secondary"
     *               onClick={row.getToggleExpandedHandler()}
     *               disabled={!hasChildren}
     *               className={!hasChildren ? 'opacity-20' : ''}
     *             >
     *               {isExpanded ? <FolderOpen /> : <Folder />}
     *             </Button>
     *             <DetailPageButton id={row.original.id} label={row.original.name} />
     *           </div>
     *           );
     *       },
     *     },
     *     // Use `meta.disabled` to completely exclude a column from the table,
     *     // including the column visibility toggle. This is useful when you need
     *     // to fetch certain fields for use in custom cell renderers, but don't
     *     // want those fields to appear as their own columns.
     *     productVariantCount: {
     *       meta: { disabled: true },
     *     },
     * ```
     */
    customizeColumns?: CustomizeColumnConfig<T>;
    /**
     * @description
     * Allows you to define extra columns that are not related to actual fields returned in
     * the query result.
     *
     * For example, in the Administrator list, we define an additional "name" column composed
     * of the `firstName` and `lastName` fields.
     *
     * @example
     * ```tsx
     * <ListPage
     *   pageId="administrator-list"
     *   title="Administrators"
     *   listQuery={administratorListDocument}
     *   additionalColumns={{
     *     name: {
     *         header: 'Name',
     *         cell: ({ row }) => (
     *             <DetailPageButton
     *                 id={row.original.id}
     *                 label={`${row.original.firstName} ${row.original.lastName}`}
     *             />
     *         ),
     *   },
     * />
     * ```
     */
    additionalColumns?: AC;
    /**
     * @description
     * Allows you to specify the default order of columns in the table. When not defined, the
     * order of fields in the list query document will be used.
     */
    defaultColumnOrder?: (keyof ListQueryFields<T> | keyof AC | CustomFieldKeysOfItem<ListQueryFields<T>>)[];
    /**
     * @description
     * Allows you to specify the default sorting applied to the table.
     *
     * @example
     * ```tsx
     * defaultSort={[{ id: 'updatedAt', desc: true }]}
     * ```
     */
    defaultSort?: SortingState;
    /**
     * @description
     * Allows you to specify the default columns that are visible in the table.
     * If you set them to `true`, then only those will show by default. If you set them to `false`,
     * then _all other_ columns will be visible by default.
     *
     * @example
     * ```tsx
     *  <ListPage
     *    pageId="country-list"
     *    listQuery={countriesListQuery}
     *    title="Countries"
     *    defaultVisibility={{
     *        name: true,
     *        code: true,
     *        enabled: true,
     *    }}
     *  />
     *  ```
     */
    defaultVisibility?: Partial<
        Record<keyof ListQueryFields<T> | keyof AC | CustomFieldKeysOfItem<ListQueryFields<T>>, boolean>
    >;
    children?: React.ReactNode;
    /**
     * @description
     * Allows you to define pre-set filters based on an array of possible selections
     *
     * @example
     * ```tsx
     * <ListPage
     *   pageId="payment-method-list"
     *   listQuery={paymentMethodListQuery}
     *   title="Payment Methods"
     *   facetedFilters={{
     *       enabled: {
     *           title: 'Enabled',
     *           options: [
     *               { label: 'Enabled', value: true },
     *               { label: 'Disabled', value: false },
     *           ],
     *       },
     *   }}
     * />
     * ```
     */
    facetedFilters?: FacetedFilterConfig<T>;
    /**
     * @description
     * Allows you to specify additional "actions" that will be made available in the "actions" column.
     * By default, the actions column includes all bulk actions defined in the `bulkActions` prop.
     */
    rowActions?: RowAction<ListQueryFields<T>>[];
    /**
     * @description
     * Allows the returned list query data to be transformed in some way. This is an advanced feature
     * that is not often required.
     */
    transformData?: (data: any[]) => any[];
    /**
     * @description
     * Allows you to directly manipulate the Tanstack Table `TableOptions` object before the
     * table is created. And advanced option that is not often required.
     */
    setTableOptions?: (table: TableOptions<any>) => TableOptions<any>;
    /**
     * @description
     * Bulk actions are actions that can be applied to one or more table rows, and include things like
     *
     * - Deleting the rows
     * - Assigning the rows to another channel
     * - Bulk editing some aspect of the rows
     *
     * See the {@link BulkAction} docs for an example of how to build the component.
     *
     * @example
     * ```tsx
     * <ListPage
     *   pageId="product-list"
     *   listQuery={productListDocument}
     *   title="Products"
     *   bulkActions={[
     *     {
     *       component: AssignProductsToChannelBulkAction,
     *       order: 100,
     *     },
     *     {
     *       component: RemoveProductsFromChannelBulkAction,
     *       order: 200,
     *     },
     *     {
     *       component: DeleteProductsBulkAction,
     *       order: 300,
     *     },
     *   ]}
     * />
     * ```
     */
    bulkActions?: BulkActionsInput;
    /**
     * @description
     * Register a function that allows you to assign a refresh function for
     * this list. The function can be assigned to a ref and then called when
     * the list needs to be refreshed.
     */
    registerRefresher?: PaginatedListRefresherRegisterFn;
    /**
     * @description
     * Callback when items are reordered via drag and drop.
     * Only applies to top-level items. When provided, enables drag-and-drop functionality.
     *
     * @param oldIndex - The original index of the dragged item
     * @param newIndex - The new index where the item was dropped
     * @param item - The data of the item that was moved
     */
    onReorder?: (oldIndex: number, newIndex: number, item: any) => void | Promise<void>;
    /**
     * @description
     * When true, drag and drop will be disabled. This will only have an effect if the onReorder prop is also set Useful when filtering or searching.
     * Defaults to false. Only relevant when `onReorder` is provided.
     */
    disableDragAndDrop?: boolean;
}

/**
 * @description
 * Auto-generates a list page with columns generated based on the provided query document fields.
 *
 * @example
 * ```tsx
 * import {
 *     Button,
 *     DashboardRouteDefinition,
 *     ListPage,
 *     PageActionBarRight,
 *     DetailPageButton,
 * } from '@vendure/dashboard';
 * import { Link } from '@tanstack/react-router';
 * import { PlusIcon } from 'lucide-react';
 *
 * // This function is generated for you by the `vendureDashboardPlugin` in your Vite config.
 * // It uses gql-tada to generate TypeScript types which give you type safety as you write
 * // your queries and mutations.
 * import { graphql } from '@/gql';
 *
 * // The fields you select here will be automatically used to generate the appropriate columns in the
 * // data table below.
 * const getArticleList = graphql(`
 *     query GetArticles($options: ArticleListOptions) {
 *         articles(options: $options) {
 *             items {
 *                 id
 *                 createdAt
 *                 updatedAt
 *                 isPublished
 *                 title
 *                 slug
 *                 body
 *                 customFields
 *             }
 *             totalItems
 *         }
 *     }
 * `);
 *
 * const deleteArticleDocument = graphql(`
 *     mutation DeleteArticle($id: ID!) {
 *         deleteArticle(id: $id) {
 *             result
 *         }
 *     }
 * `);
 *
 * export const articleList: DashboardRouteDefinition = {
 *     navMenuItem: {
 *         sectionId: 'catalog',
 *         id: 'articles',
 *         url: '/articles',
 *         title: 'CMS Articles',
 *     },
 *     path: '/articles',
 *     loader: () => ({
 *         breadcrumb: 'Articles',
 *     }),
 *     component: route => (
 *         <ListPage
 *             pageId="article-list"
 *             title="Articles"
 *             listQuery={getArticleList}
 *             deleteMutation={deleteArticleDocument}
 *             route={route}
 *             customizeColumns={{
 *                 title: {
 *                     cell: ({ row }) => {
 *                         const post = row.original;
 *                         return <DetailPageButton id={post.id} label={post.title} />;
 *                     },
 *                 },
 *             }}
 *         >
 *             <PageActionBarRight>
 *                 <Button render={<Link to="./new" />}>
 *                     <PlusIcon className="mr-2 h-4 w-4" />
 *                     New article
 *                 </Button>
 *             </PageActionBarRight>
 *         </ListPage>
 *     ),
 * };
 * ```
 * @docsCategory list-views
 * @docsPage ListPage
 * @docsWeight 0
 * @since 3.3.0
 */
export function ListPage<
    T extends TypedDocumentNode<U, V>,
    U extends Record<string, any> = any,
    V extends ListQueryOptionsShape = ListQueryOptionsShape,
    AC extends AdditionalColumns<T> = AdditionalColumns<T>,
>({
    pageId,
    title,
    listQuery,
    deleteMutation,
    transformVariables,
    customizeColumns,
    additionalColumns,
    defaultColumnOrder,
    defaultSort,
    route: routeOrFn,
    defaultVisibility,
    onSearchTermChange,
    facetedFilters,
    children,
    rowActions,
    transformData,
    setTableOptions,
    bulkActions,
    registerRefresher,
    onReorder,
    disableDragAndDrop = false,
}: Readonly<ListPageProps<T, U, V, AC>>) {
    const route = typeof routeOrFn === 'function' ? routeOrFn() : routeOrFn;
    const routeSearch = route.useSearch();
    const navigate = useNavigate<AnyRouter>({ from: route.fullPath });
    const { setTableSettings, settings } = useUserSettings();
    const tableSettings = pageId ? settings.tableSettings?.[pageId] : undefined;

    const pagination = {
        page: routeSearch.page ? Number.parseInt(routeSearch.page) : 1,
        itemsPerPage: routeSearch.perPage ? Number.parseInt(routeSearch.perPage) : (tableSettings?.pageSize ?? 10),
    };

    const columnVisibility = pageId
        ? (tableSettings?.columnVisibility ?? defaultVisibility)
        : defaultVisibility;
    const columnOrder = pageId ? (tableSettings?.columnOrder ?? defaultColumnOrder) : defaultColumnOrder;
    const columnFilters = pageId ? tableSettings?.columnFilters : routeSearch.filters;

    const sorting: SortingState = (routeSearch.sort ?? '')
        .split(',')
        .filter((s: string) => s.length)
        .map((s: string) => {
            return {
                id: s.replace(/^-/, ''),
                desc: s.startsWith('-'),
            };
        });

    if (defaultSort && !sorting.length) {
        sorting.push(...defaultSort);
    }

    function sortToString(sortingStates?: SortingState) {
        return sortingStates?.map(s => `${s.desc ? '-' : ''}${s.id}`).join(',');
    }

    function persistListStateToUrl(
        table: Table<any>,
        listState: {
            page?: number;
            perPage?: number;
            sort?: SortingState;
            filters?: ColumnFiltersState;
        },
    ) {
        const tableState = table.getState();
        const page = listState.page || tableState.pagination.pageIndex + 1;
        const perPage = listState.perPage || tableState.pagination.pageSize;
        const sort = sortToString(listState.sort ?? tableState.sorting);
        const filters = listState.filters ?? tableState.columnFilters;
        navigate({
            search: (prev: Record<string, unknown>) =>
                ({ ...prev, sort, page, perPage, filters: filters.length ? filters : undefined }) as never,
        });
    }

    const commonTableProps = {
        listQuery,
        deleteMutation,
        transformVariables,
        customizeColumns: customizeColumns as any,
        additionalColumns: additionalColumns as any,
        defaultColumnOrder: columnOrder as any,
        defaultVisibility: columnVisibility as any,
        onSearchTermChange,
        page: pagination.page,
        itemsPerPage: pagination.itemsPerPage,
        sorting,
        columnFilters,
        onPageChange: (table: Table<any>, page: number, perPage: number) => {
            persistListStateToUrl(table, { page, perPage });
            if (pageId) {
                setTableSettings(pageId, 'pageSize', perPage);
            }
        },
        onSortChange: (table: Table<any>, sorting: SortingState) => {
            persistListStateToUrl(table, { sort: sorting });
        },
        onFilterChange: (table: Table<any>, filters: ColumnFiltersState) => {
            persistListStateToUrl(table, { filters });
            if (pageId) {
                setTableSettings(pageId, 'columnFilters', filters);
            }
        },
        onColumnVisibilityChange: (table: Table<any>, columnVisibility: any) => {
            if (pageId) {
                setTableSettings(pageId, 'columnVisibility', columnVisibility);
            }
        },
        facetedFilters,
        rowActions,
        bulkActions,
        setTableOptions,
        transformData,
        registerRefresher,
    };

    return (
        <Page pageId={pageId}>
            <PageTitle>{title}</PageTitle>
            <PageActionBar>{children}</PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="list-table">
                    <PaginatedListDataTable
                        {...commonTableProps}
                        onReorder={onReorder}
                        disableDragAndDrop={disableDragAndDrop}
                    />
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
