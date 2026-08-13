import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { PlusIcon } from 'lucide-react';
import { ReactNode, useRef, useState } from 'react';
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
    title?: ReactNode;
}

export function ProductOptionsTable({
    productOptionGroupId,
    registerRefresher,
    getOptionHref,
    newOptionHref,
    linkSearch,
    title,
}: Readonly<ProductOptionsTableProps>) {
    const { t } = useLingui();
    const { pageId } = usePage();
    const { setTableSettings } = useUserSettings();

    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
    const refreshRef = useRef<() => void>(() => {});

    return (
        <PaginatedListDataTable
            title={title}
            actions={
                <Button
                    render={<Link to={newOptionHref ?? './options/new'} search={linkSearch} />}
                    variant="outline"
                    size="sm"
                >
                    <PlusIcon />
                    <Trans>Add product option</Trans>
                </Button>
            }
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
            onColumnVisibilityChange={(_, columnVisibility) => {
                if (pageId) {
                    setTableSettings(pageId, 'columnVisibility', columnVisibility);
                }
            }}
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
            searchPlaceholder={t`Search options...`}
            onSearchTermChange={searchTerm => {
                return {
                    name: {
                        contains: searchTerm,
                    },
                };
            }}
            defaultVisibility={{
                name: true,
                code: true,
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => (
                        <DetailPageButton
                            id={row.original.id}
                            label={row.original.name}
                            href={
                                getOptionHref ? getOptionHref(row.original.id) : `options/${row.original.id}`
                            }
                            search={linkSearch}
                        />
                    ),
                },
            }}
        />
    );
}
