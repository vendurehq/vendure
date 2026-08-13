import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { Trans } from '@lingui/react/macro';
import { TrashIcon } from 'lucide-react';
import { useState } from 'react';

import { DeleteStockLocationsDialog } from './delete-stock-locations-dialog.js';

import {
    assignStockLocationsToChannelDocument,
    removeStockLocationsFromChannelDocument,
} from '../stock-locations.graphql.js';

export const DeleteStockLocationsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { refetchPaginatedList } = usePaginatedList();
    const [dialogOpen, setDialogOpen] = useState(false);

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={['DeleteStockLocation']}
                onClick={() => setDialogOpen(true)}
                label={<Trans>Delete</Trans>}
                icon={TrashIcon}
                className="text-destructive"
                // Keep the dropdown open so opening the dialog in the same tick doesn't race with
                // the menu unmounting (which would prevent the dialog from mounting).
                closeOnClick={false}
            />
            <DeleteStockLocationsDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                selection={selection}
                onSuccess={() => {
                    refetchPaginatedList();
                    table.resetRowSelection();
                }}
            />
        </>
    );
};

export const AssignStockLocationsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="stock locations"
            mutationFn={api.mutate(assignStockLocationsToChannelDocument)}
            requiredPermissions={['UpdateStockLocation']}
            buildInput={(channelId: string) => ({
                stockLocationIds: selection.map(s => s.id),
                channelId,
            })}
        />
    );
};

export const RemoveStockLocationsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="stock locations"
            mutationFn={api.mutate(removeStockLocationsFromChannelDocument)}
            requiredPermissions={['UpdateStockLocation']}
            buildInput={() => ({
                stockLocationIds: selection.map(s => s.id),
                channelId: activeChannel?.id,
            })}
        />
    );
};
