import { useQueryClient } from '@tanstack/react-query';
import { FolderTree } from 'lucide-react';
import { useState } from 'react';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { DuplicateBulkAction } from '../../../../common/duplicate-bulk-action.js';
import {
    assignCollectionToChannelDocument,
    deleteCollectionsDocument,
    removeCollectionFromChannelDocument,
} from '../collections.graphql.js';
import { MoveCollectionsDialog } from './move-collections-dialog.js';

export const AssignCollectionsToChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const queryClient = useQueryClient();

    return (
        <AssignToChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="collections"
            mutationFn={api.mutate(assignCollectionToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateCollection']}
            buildInput={(channelId: string) => ({
                collectionIds: selectedRowIds,
                channelId,
            })}
            onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['childCollections'] });
            }}
        />
    );
};

export const RemoveCollectionsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="collections"
            mutationFn={api.mutate(removeCollectionFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateCollection']}
            buildInput={() => ({
                collectionIds: selectedRowIds,
                channelId: activeChannel?.id,
            })}
            onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['childCollections'] });
            }}
        />
    );
};

export const DuplicateCollectionsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const queryClient = useQueryClient();
    return (
        <DuplicateBulkAction
            entityType="Collection"
            duplicatorCode="collection-duplicator"
            requiredPermissions={['UpdateCatalog', 'UpdateCollection']}
            entityName="Collection"
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            onSuccess={() => {
                queryClient.invalidateQueries({ queryKey: ['childCollections'] });
            }}
        />
    );
};

export const DeleteCollectionsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteCollectionsDocument}
            entityName="collections"
            requiredPermissions={['DeleteCatalog', 'DeleteCollection']}
            invalidateQueries={['childCollections']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};

export const MoveCollectionsBulkAction: BulkActionComponent<any> = ({ selection, missingRowIds, table }) => {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { refetchPaginatedList } = usePaginatedList();

    const handleSuccess = () => {
        refetchPaginatedList();
        table.resetRowSelection();
    };

    const handleResetExpanded = () => {
        const refreshChildCaches = (table.options.meta as { refreshChildCaches: () => void })?.refreshChildCaches;
        if (refreshChildCaches) {
            refreshChildCaches();
        }
    };

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={['UpdateCatalog', 'UpdateCollection']}
                onClick={() => setDialogOpen(true)}
                label={<Trans>Move</Trans>}
                icon={FolderTree}
                // Moving needs each collection's data, which rows on other pages do not have loaded.
                disabled={missingRowIds.length > 0}
                disabledReason={<Trans>Go to the pages of all selected collections first</Trans>}
                closeOnClick={false}
            />
            <MoveCollectionsDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                collectionsToMove={selection}
                onSuccess={handleSuccess}
                onResetExpanded={handleResetExpanded}
            />
        </>
    );
};
