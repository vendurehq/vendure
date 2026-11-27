import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { ReactNode, useState } from 'react';

export const collectionContentsDocument = graphql(`
    query CollectionContentsList($collectionId: ID!, $options: ProductVariantListOptions) {
        collection(id: $collectionId) {
            id
            productVariants(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    name
                    sku
                }
                totalItems
            }
        }
    }
`);

export interface CollectionContentsTableProps {
    collectionId?: string;
    title?: ReactNode;
}

export function CollectionContentsTable({ collectionId, title }: Readonly<CollectionContentsTableProps>) {
    const { t } = useLingui();
    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);

    return (
        <PaginatedListDataTable
            title={title}
            listQuery={addCustomFields(collectionContentsDocument)}
            // Draws as many skeleton rows as this Collection had at its last load.
            rowCountKey={collectionId ? `collection-contents:${collectionId}` : undefined}
            transformVariables={variables => {
                return {
                    ...variables,
                    collectionId: collectionId,
                };
            }}
            // SKU has a width and the name takes the rest of the row, so the columns
            // stand where the rows will put them while the list loads. The name
            // skeleton is as tall as the name's button, so a row keeps its height.
            skeletonCells={{
                name: (
                    <div className="flex h-8.5 items-center">
                        <Skeleton className="h-4 w-48" />
                    </div>
                ),
            }}
            customizeColumns={{
                sku: {
                    meta: { width: '12rem' },
                },
                name: {
                    // The inset of the ghost name button, so the column keeps its indent
                    // before the rows arrive.
                    meta: { contentInset: 'calc(var(--spacing) * 3.25 + 1px)' },
                    header: 'Variant name',
                    cell: ({ row }) => {
                        return (
                            <Button
                                render={<Link to={`../../product-variants/${row.original.id}`} />}
                                variant="ghost"
                            >
                                {row.original.name}{' '}
                            </Button>
                        );
                    },
                },
            }}
            page={page}
            itemsPerPage={pageSize}
            sorting={sorting}
            columnFilters={filters}
            onPageChange={(_, page, perPage) => {
                setPage(page);
                setPageSize(perPage);
            }}
            onSortChange={(_, sorting) => {
                setSorting(sorting);
            }}
            onFilterChange={(_, filters) => {
                setFilters(filters);
            }}
            searchPlaceholder={t`Search variants...`}
            onSearchTermChange={searchTerm => {
                return {
                    name: {
                        contains: searchTerm,
                    },
                };
            }}
        />
    );
}
