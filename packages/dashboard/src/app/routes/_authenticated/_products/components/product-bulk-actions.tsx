import { TagIcon } from 'lucide-react';
import { useState } from 'react';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { usePriceFactor } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannelAvailabilityOption } from '@/vdb/hooks/use-channel-availability-option.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { Trans } from '@lingui/react/macro';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { DuplicateBulkAction } from '../../../../common/duplicate-bulk-action.js';
import {
    assignProductsToChannelDocument,
    deleteProductsDocument,
    getProductsWithFacetValuesByIdsDocument,
    productDetailDocument,
    removeProductsFromChannelDocument,
    updateProductsDocument,
} from '../products.graphql.js';
import { AssignFacetValuesDialog } from './assign-facet-values-dialog.js';

export const DeleteProductsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteProductsDocument}
            entityName="products"
            requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};

export const AssignProductsToChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const { priceFactor, priceFactorField } = usePriceFactor();
    const { enabledInChannel, channelAvailabilityField } = useChannelAvailabilityOption();

    return (
        <AssignToChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="products"
            mutationFn={api.mutate(assignProductsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={(channelId: string) => ({
                productIds: selectedRowIds,
                channelId,
                priceFactor,
                enabledInChannel,
            })}
            additionalFields={
                <>
                    {priceFactorField}
                    {channelAvailabilityField}
                </>
            }
        />
    );
};

export const RemoveProductsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="products"
            mutationFn={api.mutate(removeProductsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={() => ({
                productIds: selectedRowIds,
                channelId: activeChannel?.id,
            })}
        />
    );
};

export const AssignFacetValuesToProductsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const { refetchPaginatedList } = usePaginatedList();
    const [dialogOpen, setDialogOpen] = useState(false);

    const handleSuccess = () => {
        refetchPaginatedList();
        table.resetRowSelection();
    };

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={['UpdateCatalog', 'UpdateProduct']}
                onClick={() => setDialogOpen(true)}
                label={<Trans>Edit facet values</Trans>}
                icon={TagIcon}
                closeOnClick={false}
            />
            <AssignFacetValuesDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                entityIds={selectedRowIds}
                entityType="products"
                queryFn={variables => api.query(getProductsWithFacetValuesByIdsDocument, variables)}
                mutationFn={api.mutate(updateProductsDocument)}
                detailDocument={productDetailDocument}
                onSuccess={handleSuccess}
            />
        </>
    );
};

export const DuplicateProductsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DuplicateBulkAction
            entityType="Product"
            duplicatorCode="product-duplicator"
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            entityName="Product"
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};
