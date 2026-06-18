import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteCustomerGroupsDocument } from '../customer-groups.graphql.js';

export const DeleteCustomerGroupsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteCustomerGroupsDocument}
            entityName="customer groups"
            requiredPermissions={['DeleteCustomerGroup']}
            selection={selection}
            table={table}
        />
    );
};
