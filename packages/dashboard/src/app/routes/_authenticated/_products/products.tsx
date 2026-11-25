import { IdentifierDisplay } from '@/vdb/components/data-display/identifier.js';
import { FacetValueFacetedFilter } from '@/vdb/components/data-table/data-table-facet-value-faceted-filter.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { DropdownMenuItem } from '@/vdb/components/ui/dropdown-menu.js';
import { NoProductsIllustration } from '@/vdb/components/ui/illustrations.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannelAvailabilityList } from '@/vdb/hooks/use-channel-availability-list.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ListRestart, PlusIcon } from 'lucide-react';
import { ReactNode, useCallback } from 'react';
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

/**
 * Fits a cell's content to its column: a long name or slug ends in an ellipsis
 * instead of widening the column. The columns then have the same widths while
 * the rows load and once they arrive, whatever the content.
 */
function FitToColumn({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
    return <div className={cn('max-w-0 min-w-full truncate', className)}>{children}</div>;
}

// The thumbnail and its loading block have one size, so a loading row, a row
// with an image and a row without one have one height.
const thumbnail = <Skeleton className="size-[50px] rounded-sm" />;

function ProductListPage() {
    const { t } = useLingui();
    const channelAvailability = useChannelAvailabilityList();
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
            emptyStateIllustration={<NoProductsIllustration />}
            listQuery={productListDocument}
            title={<Trans>Products</Trans>}
            dropdownMenuItems={[
                {
                    id: 'rebuild-index-button',
                    requiresPermission: ['UpdateCatalog'],
                    component: RebuildIndexMenuItem,
                },
            ]}
            skeletonCells={{ featuredAsset: thumbnail }}
            customizeColumns={{
                featuredAsset: {
                    meta: { width: '5.5rem' },
                    // Without an image, the placeholder keeps the row as tall as a row with one.
                    cell: ({ row }) => <VendureImage asset={row.original.featuredAsset} preset="tiny" />,
                },
                name: {
                    // The one column without a width: it takes the rest of the row.
                    cell: ({ row }) => (
                        <div className="min-w-40">
                            <FitToColumn>
                                <DetailPageButton id={row.original.id} label={row.original.name} />
                            </FitToColumn>
                        </div>
                    ),
                },
                slug: {
                    meta: { width: '14rem' },
                    cell: ({ row }) => (
                        <FitToColumn>
                            <IdentifierDisplay value={row.original.slug} />
                        </FitToColumn>
                    ),
                },
                description: {
                    cell: RichTextDescriptionCell,
                },
                // With several channels, the Status filter covers `enabled`, so a second filter of the same name is left out.
                enabled: {
                    ...channelAvailability.statusColumn,
                    ...(channelAvailability.facetedFilter ? { enableColumnFilter: false } : {}),
                    meta: { ...channelAvailability.statusColumn.meta, width: '9rem' },
                },
                enabledInChannel: channelAvailability.enabledInChannelColumn,
            }}
            searchPlaceholder={t`Search products...`}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          _or: [
                              { name: { contains: searchTerm } },
                              { slug: { contains: searchTerm } },
                              { sku: { contains: searchTerm } },
                          ],
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
                [channelAvailability.filterId]: channelAvailability.filterColumn,
            }}
            transformVariables={channelAvailability.transformVariables}
            facetedFilters={{
                [channelAvailability.filterId]: channelAvailability.facetedFilter,
                facetValueId: {
                    title: t`Facet values`,
                    component: FacetValueFacetedFilter,
                },
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
