import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteSellersDocument } from '../sellers.graphql.js';

export const DeleteSellersBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteSellersDocument}
            entityName="sellers"
            requiredPermissions={['DeleteSeller']}
            selection={selection}
            table={table}
        />
    );
};
