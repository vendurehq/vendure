import { useMutation } from '@tanstack/react-query';
import { TrashIcon } from 'lucide-react';
import { toast } from 'sonner';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { api } from '@/vdb/graphql/api.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { deleteAssetsDocument } from '../assets.graphql.js';

export const DeleteAssetsBulkAction = ({
    selection,
    refetch,
}: {
    selection: AssetFragment[];
    refetch: () => void;
}) => {
    const { t } = useLingui();
    const selectionLength = selection.length;
    const { mutate } = useMutation({
        mutationFn: api.mutate(deleteAssetsDocument),
        onSuccess: (result: ResultOf<typeof deleteAssetsDocument>) => {
            if (result.deleteAssets.result === 'DELETED') {
                toast.success(t`Deleted ${selectionLength} assets`);
            } else {
                const message = result.deleteAssets.message;
                toast.error(t`Failed to delete assets: ${message}`);
            }
            refetch();
        },
        onError: () => {
            toast.error(`Failed to delete ${selectionLength} assets`);
        },
    });

    return (
        <DataTableBulkActionItem
            requiresPermission={['DeleteCatalog', 'DeleteAsset']}
            onClick={() => mutate({ input: { assetIds: selection.map(s => s.id) } })}
            label={<Trans>Delete</Trans>}
            confirmationText={<Trans>Are you sure you want to delete {selectionLength} assets?</Trans>}
            icon={TrashIcon}
        />
    );
};
