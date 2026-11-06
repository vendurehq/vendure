import { Money } from '@/vdb/components/data-display/money.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import {
    PaginatedListDataTable,
    PaginatedListRefresherRegisterFn,
} from '@/vdb/components/shared/paginated-list-data-table.js';
import { StockLevelLabel } from '@/vdb/components/shared/stock-level-label.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useLingui } from '@lingui/react/macro';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { ReactNode, useState } from 'react';
import {
    AssignFacetValuesToProductVariantsBulkAction,
    AssignProductVariantsToChannelBulkAction,
    DeleteProductVariantsBulkAction,
    RemoveProductVariantsFromChannelBulkAction,
} from '../../_product-variants/components/product-variant-bulk-actions.js';
import { productVariantListDocument } from '../products.graphql.js';

interface ProductVariantsTableProps {
    productId: string;
    registerRefresher?: PaginatedListRefresherRegisterFn;
    title?: ReactNode;
    actions?: ReactNode;
}

export function ProductVariantsTable({
    productId,
    registerRefresher,
    title,
    actions,
}: ProductVariantsTableProps) {
    const { pageId } = usePage();
    const { setTableSettings } = useUserSettings();
    const { formatCurrencyName } = useLocalFormat();
    const { t } = useLingui();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sorting, setSorting] = useState<SortingState>([]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);

    return (
        <PaginatedListDataTable
            title={title}
            actions={actions}
            registerRefresher={registerRefresher}
            listQuery={productVariantListDocument}
            transformVariables={variables => ({
                ...variables,
                productId,
            })}
            defaultVisibility={{
                featuredAsset: true,
                name: true,
                enabled: true,
                price: true,
                priceWithTax: true,
                stockLevels: true,
            }}
            bulkActions={[
                [
                    {
                        component: AssignProductVariantsToChannelBulkAction,
                        order: 100,
                    },
                    {
                        component: RemoveProductVariantsFromChannelBulkAction,
                        order: 200,
                    },
                    {
                        component: AssignFacetValuesToProductVariantsBulkAction,
                        order: 300,
                    },
                ],
                [
                    {
                        component: DeleteProductVariantsBulkAction,
                    },
                ],
            ]}
            customizeColumns={{
                name: {
                    header: t`Variant name`,
                    cell: ({ row: { original } }) => (
                        <DetailPageButton
                            href={`../../product-variants/${original.id}`}
                            label={original.name}
                        />
                    ),
                },
                currencyCode: {
                    cell: ({ row: { original } }) => formatCurrencyName(original.currencyCode, 'full'),
                },
                price: {
                    meta: {
                        dependencies: ['currencyCode'],
                    },
                    cell: ({ row: { original } }) => (
                        <Money value={original.price} currency={original.currencyCode} />
                    ),
                },
                priceWithTax: {
                    meta: {
                        dependencies: ['currencyCode'],
                    },
                    cell: ({ row: { original } }) => (
                        <Money value={original.priceWithTax} currency={original.currencyCode} />
                    ),
                },
                stockLevels: {
                    cell: ({ row: { original } }) => <StockLevelLabel stockLevels={original.stockLevels} />,
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
            onColumnVisibilityChange={(_, columnVisibility) => {
                if (pageId) {
                    setTableSettings(pageId, 'columnVisibility', columnVisibility);
                }
            }}
        />
    );
}
