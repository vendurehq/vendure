import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteApiKeysDocument } from '../api-keys.graphql.js';

export const DeleteApiKeysBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteApiKeysDocument}
            entityName="api keys"
            requiredPermissions={['DeleteApiKey']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};
