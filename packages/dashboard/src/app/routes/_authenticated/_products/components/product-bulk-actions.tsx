import { TagIcon } from 'lucide-react';
import { useState } from 'react';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { usePriceFactor } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
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

export const DeleteProductsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteProductsDocument}
            entityName="products"
            requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
            selection={selection}
            table={table}
        />
    );
};

export const AssignProductsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { priceFactor, priceFactorField } = usePriceFactor();

    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="products"
            mutationFn={api.mutate(assignProductsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={(channelId: string) => ({
                productIds: selection.map(s => s.id),
                channelId,
                priceFactor,
            })}
            additionalFields={priceFactorField}
        />
    );
};

export const RemoveProductsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="products"
            mutationFn={api.mutate(removeProductsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={() => ({
                productIds: selection.map(s => s.id),
                channelId: activeChannel?.id,
            })}
        />
    );
};

export const AssignFacetValuesToProductsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
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
                entityIds={selection.map(s => s.id)}
                entityType="products"
                queryFn={variables => api.query(getProductsWithFacetValuesByIdsDocument, variables)}
                mutationFn={api.mutate(updateProductsDocument)}
                detailDocument={productDetailDocument}
                onSuccess={handleSuccess}
            />
        </>
    );
};

export const DuplicateProductsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DuplicateBulkAction
            entityType="Product"
            duplicatorCode="product-duplicator"
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            entityName="Product"
            selection={selection}
            table={table}
        />
    );
};
