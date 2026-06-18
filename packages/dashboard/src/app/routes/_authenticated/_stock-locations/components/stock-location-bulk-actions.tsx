import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';

import {
    assignStockLocationsToChannelDocument,
    deleteStockLocationsDocument,
    removeStockLocationsFromChannelDocument,
} from '../stock-locations.graphql.js';

export const DeleteStockLocationsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteStockLocationsDocument}
            entityName="stock locations"
            requiredPermissions={['DeleteStockLocation']}
            selection={selection}
            table={table}
        />
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
