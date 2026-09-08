import { FacetValueFacetedFilter } from '@/vdb/components/data-table/data-table-facet-value-faceted-filter.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { DropdownMenuItem } from '@/vdb/components/ui/dropdown-menu.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ListRestart, PlusIcon } from 'lucide-react';
import { useCallback } from 'react';
import { toast } from 'sonner';
import {
    AssignFacetValuesToProductsBulkAction,
    AssignProductsToChannelBulkAction,
    DeleteProductsBulkAction,
    DuplicateProductsBulkAction,
    RemoveProductsFromChannelBulkAction,
} from './components/product-bulk-actions.js';
import { productListDocument, reindexDocument } from './products.graphql.js';

export const Route = createFileRoute('/_authenticated/_products/products')({
    component: ProductListPage,
    loader: () => ({ breadcrumb: () => <Trans>Products</Trans> }),
});

function ProductListPage() {
    const { t } = useLingui();
    const reindexMutation = useMutation({
        mutationFn: () => api.mutate(reindexDocument, {}),
        onSuccess: () => {
            toast.success(t`Search index rebuild started`);
        },
        onError: () => {
            toast.error(t`Search index rebuild could not be started`);
        },
    });

    const RebuildIndexMenuItem = useCallback(
        () => (
            <DropdownMenuItem onClick={() => reindexMutation.mutate()}>
                <ListRestart className="w-4 h-4" />
                <Trans>Rebuild search index</Trans>
            </DropdownMenuItem>
        ),
        [reindexMutation.mutate],
    );

    return (
        <ListPage
            pageId="product-list"
            listQuery={productListDocument}
            title={<Trans>Products</Trans>}
            dropdownMenuItems={[
                {
                    id: 'rebuild-index-button',
                    requiresPermission: ['UpdateCatalog'],
                    component: RebuildIndexMenuItem,
                },
            ]}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                description: {
                    cell: RichTextDescriptionCell,
                },
            }}
            searchPlaceholder={t`Search products...`}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          name: { contains: searchTerm },
                          slug: { contains: searchTerm },
                          sku: { contains: searchTerm },
                      }
                    : {};
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
            transformVariables={variables => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            defaultSort={[{ id: 'updatedAt', desc: true }]}
            defaultVisibility={{
                name: true,
                featuredAsset: true,
                slug: true,
                enabled: true,
            }}
            route={Route}
            emptyStateAction={
                <PermissionGuard requires={['CreateProduct', 'CreateCatalog']}>
                    <Button render={<Link to="./new" />}>
                        <PlusIcon className="mr-2 h-4 w-4" />
                        <Trans>Create your first product</Trans>
                    </Button>
                </PermissionGuard>
            }
            bulkActions={[
                [
                    { component: AssignProductsToChannelBulkAction, order: 100 },
                    { component: RemoveProductsFromChannelBulkAction, order: 200 },
                    { component: AssignFacetValuesToProductsBulkAction, order: 300 },
                    { component: DuplicateProductsBulkAction, order: 400 },
                ],
                [{ component: DeleteProductsBulkAction }],
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateProduct', 'CreateCatalog']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Product</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
