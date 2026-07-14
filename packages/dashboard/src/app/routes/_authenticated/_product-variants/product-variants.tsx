import { Money } from '@/vdb/components/data-display/money.js';
import { FacetValueFacetedFilter } from '@/vdb/components/data-table/data-table-facet-value-faceted-filter.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { StockLevelLabel } from '@/vdb/components/shared/stock-level-label.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import {
    AssignFacetValuesToProductVariantsBulkAction,
    AssignProductVariantsToChannelBulkAction,
    DeleteProductVariantsBulkAction,
    RemoveProductVariantsFromChannelBulkAction,
} from './components/product-variant-bulk-actions.js';
import { productVariantListDocument } from './product-variants.graphql.js';

export const Route = createFileRoute('/_authenticated/_product-variants/product-variants')({
    component: ProductListPage,
    loader: () => ({ breadcrumb: () => <Trans>Product Variants</Trans> }),
});

function ProductListPage() {
    const { formatCurrencyName } = useLocalFormat();
    const { t } = useLingui();
    return (
        <ListPage
            pageId="product-variant-list"
            title={<Trans>Product Variants</Trans>}
            listQuery={productVariantListDocument}
            defaultVisibility={{
                featuredAsset: true,
                name: true,
                sku: true,
                priceWithTax: true,
                enabled: true,
                stockLevels: true,
            }}
            bulkActions={[
                [
                    { component: AssignProductVariantsToChannelBulkAction, order: 100 },
                    { component: RemoveProductVariantsFromChannelBulkAction, order: 200 },
                    { component: AssignFacetValuesToProductVariantsBulkAction, order: 300 },
                ],
                [
                    { component: DeleteProductVariantsBulkAction },
                ],
            ]}
            customizeColumns={{
                name: {
                    cell: ({ row: { original } }) => (
                        <DetailPageButton id={original.id} label={original.name} />
                    ),
                },
                currencyCode: {
                    cell: ({ row: { original } }) => formatCurrencyName(original.currencyCode, 'full'),
                },
                price: {
                    meta: { dependencies: ['currencyCode'] },
                    cell: ({ row: { original } }) => (
                        <Money value={original.price} currency={original.currencyCode} />
                    ),
                },
                priceWithTax: {
                    meta: { dependencies: ['currencyCode'] },
                    cell: ({ row: { original } }) => (
                        <Money value={original.priceWithTax} currency={original.currencyCode} />
                    ),
                },
                stockLevels: {
                    cell: ({ row: { original } }) => <StockLevelLabel stockLevels={original.stockLevels} />,
                },
            }}
            additionalColumns={{
                facetValueId: {
                    header: '',
                    cell: () => null,
                    enableSorting: false,
                    enableHiding: false,
                    enableColumnFilter: false,
                },
            }}
            facetedFilters={{
                facetValueId: {
                    title: t`Facet values`,
                    component: FacetValueFacetedFilter,
                },
            }}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          name: { contains: searchTerm },
                          sku: { contains: searchTerm },
                      }
                    : {};
            }}
            transformVariables={variables => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            route={Route}
        ></ListPage>
    );
}
