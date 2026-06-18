import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState, VisibilityState } from '@tanstack/react-table';
import { PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { deleteProductOptionDocument } from '../product-option-groups.graphql.js';

export const productOptionListDocument = graphql(`
    query ProductOptionList($options: ProductOptionListOptions, $groupId: ID) {
        productOptions(options: $options, groupId: $groupId) {
            items {
                id
                createdAt
                updatedAt
                name
                code
            }
            totalItems
        }
    }
`);

export interface ProductOptionsTableProps {
    productOptionGroupId: string;
    registerRefresher?: (refresher: () => void) => void;
    getOptionHref?: (optionId: string) => string;
    newOptionHref?: string;
    linkSearch?: Record<string, string>;
}

export function ProductOptionsTable({
    productOptionGroupId,
    registerRefresher,
    getOptionHref,
    newOptionHref,
    linkSearch,
}: Readonly<ProductOptionsTableProps>) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
        name: true,
        code: true,
    });
    const refreshRef = useRef<() => void>(() => {});

    return (
        <>
            <PaginatedListDataTable
                listQuery={productOptionListDocument}
                deleteMutation={deleteProductOptionDocument}
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
                onColumnVisibilityChange={(_, value) => setColumnVisibility(value)}
                onFilterChange={(_, filters) => {
                    setFilters(filters);
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
                                groupId: { eq: productOptionGroupId },
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
                defaultVisibility={columnVisibility}
                customizeColumns={{
                    name: {
                        cell: ({ row }) => (
                            <DetailPageButton
                                id={row.original.id}
                                label={row.original.name}
                                href={
                                    getOptionHref
                                        ? getOptionHref(row.original.id)
                                        : `options/${row.original.id}`
                                }
                                search={linkSearch}
                            />
                        ),
                    },
                }}
            />
            <div className="mt-4">
                <Button render={<Link to={newOptionHref ?? './options/new'} search={linkSearch} />} variant="outline">
                    <PlusIcon />
                    <Trans>Add product option</Trans>
                </Button>
            </div>
        </>
    );
}
