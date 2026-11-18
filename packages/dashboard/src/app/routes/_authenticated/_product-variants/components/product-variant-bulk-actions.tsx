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

import { AssignFacetValuesDialog } from '../../_products/components/assign-facet-values-dialog.js';
import {
    assignProductVariantsToChannelDocument,
    deleteProductVariantsDocument,
    getProductVariantsWithFacetValuesByIdsDocument,
    productVariantDetailDocument,
    removeProductVariantsFromChannelDocument,
    updateProductVariantsDocument,
} from '../product-variants.graphql.js';

export const DeleteProductVariantsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteProductVariantsDocument}
            entityName="product variants"
            requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};

export const AssignProductVariantsToChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const { priceFactor, priceFactorField } = usePriceFactor();
    const { enabledInChannel, channelAvailabilityField } = useChannelAvailabilityOption();

    return (
        <AssignToChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="variants"
            mutationFn={api.mutate(assignProductVariantsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={(channelId: string) => ({
                productVariantIds: selectedRowIds,
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

export const RemoveProductVariantsFromChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    selectedRowIds,
    table,
}) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="product variants"
            mutationFn={api.mutate(removeProductVariantsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={() => ({
                productVariantIds: selectedRowIds,
                channelId: activeChannel?.id,
            })}
        />
    );
};

export const AssignFacetValuesToProductVariantsBulkAction: BulkActionComponent<any> = ({
    selection,
    selectedRowIds,
    table,
}) => {
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
                entityType="variants"
                queryFn={variables => api.query(getProductVariantsWithFacetValuesByIdsDocument, variables)}
                mutationFn={api.mutate(updateProductVariantsDocument)}
                detailDocument={productVariantDetailDocument}
                onSuccess={handleSuccess}
            />
        </>
    );
};
