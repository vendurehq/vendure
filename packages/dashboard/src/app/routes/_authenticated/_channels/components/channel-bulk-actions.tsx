import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteChannelsDocument } from '../channels.graphql.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

export const DeleteChannelsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { refreshChannels } = useChannel();
    return (
        <DeleteBulkAction
            mutationDocument={deleteChannelsDocument}
            entityName="channels"
            requiredPermissions={['DeleteChannel']}
            onSuccess={refreshChannels}
            selection={selection}
            table={table}
        />
    );
};
