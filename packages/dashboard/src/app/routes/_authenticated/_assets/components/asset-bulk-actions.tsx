import { TrashIcon } from 'lucide-react';
import { toast } from 'sonner';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { PaginatedListDataTableKey } from '@/vdb/components/shared/paginated-list-data-table.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteAssetsDocument } from '../assets.graphql.js';

export const DeleteAssetsBulkAction: BulkActionComponent<AssetFragment> = ({ selection, selectedRowIds, table }) => {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const selectionLength = selectedRowIds.length;
    const { mutate } = useMutation({
        mutationFn: api.mutate(deleteAssetsDocument),
        onSuccess: (result: ResultOf<typeof deleteAssetsDocument>) => {
            if (result.deleteAssets.result === 'DELETED') {
                toast.success(t`Deleted ${selectionLength} assets`);
            } else {
                const message = result.deleteAssets.message;
                toast.error(t`Failed to delete assets: ${message}`);
            }
            table.resetRowSelection();
            queryClient.invalidateQueries({ queryKey: ['AssetGallery'] });
            queryClient.invalidateQueries({ queryKey: [PaginatedListDataTableKey] });
        },
        onError: () => {
            toast.error(t`Failed to delete ${selectionLength} assets`);
        },
    });

    return (
        <DataTableBulkActionItem
            requiresPermission={['DeleteCatalog', 'DeleteAsset']}
            onClick={() => mutate({ input: { assetIds: selectedRowIds } })}
            label={<Trans>Delete</Trans>}
            variant="destructive"
            confirmationTitle={<Trans>Delete {selectionLength} assets?</Trans>}
            confirmationText={<Trans>This cannot be undone.</Trans>}
            confirmLabel={<Trans>Delete</Trans>}
            icon={TrashIcon}
        />
    );
};
