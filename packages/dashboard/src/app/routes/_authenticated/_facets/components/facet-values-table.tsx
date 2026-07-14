import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { SortingState } from '@tanstack/react-table';
import { PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { DeleteFacetValuesBulkAction } from './facet-value-bulk-actions.js';

const pageId = 'facet-values-table';

export const facetValueListDocument = graphql(`
    query FacetValueList($options: FacetValueListOptions) {
        facetValues(options: $options) {
            items {
                id
                createdAt
                updatedAt
                name
                code
                customFields
            }
            totalItems
        }
    }
`);

export interface FacetValuesTableProps {
    facetId: string;
    registerRefresher?: (refresher: () => void) => void;
}

export function FacetValuesTable({ facetId, registerRefresher }: Readonly<FacetValuesTableProps>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const { setTableSettings, settings } = useUserSettings();
    const refreshRef = useRef<() => void>(() => {});

    const tableSettings = pageId ? settings.tableSettings?.[pageId] : undefined;
    const defaultVisibility = {
        name: true,
        code: true,
    };

    const columnVisibility = pageId
        ? (tableSettings?.columnVisibility ?? defaultVisibility)
        : defaultVisibility;
    const columnOrder = pageId ? (tableSettings?.columnOrder ?? []) : ['name', 'code'];
    const columnFilters = pageId ? tableSettings?.columnFilters : [];

    return (
        <>
            <PaginatedListDataTable
                listQuery={addCustomFields(facetValueListDocument)}
                page={page}
                itemsPerPage={pageSize}
                sorting={sorting}
                columnFilters={columnFilters}
                defaultColumnOrder={columnOrder}
                defaultVisibility={columnVisibility}
                onPageChange={(table, page, perPage) => {
                    if (pageId) {
                        setPageSize(perPage);
                        setPage(page);
                    }
                }}
                onSortChange={(table, sorting) => {
                    setSorting(sorting);
                }}
                onFilterChange={(table, filters) => {
                    if (pageId) {
                        setTableSettings(pageId, 'columnFilters', filters);
                    }
                }}
                onColumnVisibilityChange={(table, columnVisibility) => {
                    if (pageId) {
                        setTableSettings(pageId, 'columnVisibility', columnVisibility);
                    }
                }}
                registerRefresher={refresher => {
                    refreshRef.current = refresher;
                    registerRefresher?.(refresher);
                }}
                transformVariables={variables => {
                    const filter = variables.options?.filter ?? {};
                    return {
                        options: {
                            filter: {
                                ...filter,
                                facetId: { eq: facetId },
                            },
                            sort: variables.options?.sort,
                            take: pageSize,
                            skip: (page - 1) * pageSize,
                        },
                    };
                }}
                onSearchTermChange={searchTerm => {
                    return {
                        name: {
                            contains: searchTerm,
                        },
                    };
                }}
                customizeColumns={{
                    name: {
                        header: 'Name',
                        cell: ({ row }) => (
                            <DetailPageButton
                                id={row.original.id}
                                label={row.original.name}
                                href={`/facets/${facetId}/values/${row.original.id}`}
                            />
                        ),
                    },
                }}
                bulkActions={[
                    {
                        component: DeleteFacetValuesBulkAction,
                    },
                ]}
            />
            <div className="mt-4">
                <Button render={<Link to={`/facets/${facetId}/values/new`} />} variant="outline">
                    <PlusIcon />
                    <Trans>Add facet value</Trans>
                </Button>
            </div>
        </>
    );
}
