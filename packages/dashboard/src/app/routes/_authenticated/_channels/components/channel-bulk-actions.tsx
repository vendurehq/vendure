import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteChannelsDocument } from '../channels.graphql.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';

export const DeleteChannelsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteChannelsDocument}
            entityName="channels"
            requiredPermissions={['DeleteChannel']}
            selection={selection}
            table={table}
        />
    );
};
