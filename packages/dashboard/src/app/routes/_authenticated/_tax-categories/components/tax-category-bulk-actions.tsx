import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteTaxCategoriesDocument } from '../tax-categories.graphql.js';

export const DeleteTaxCategoriesBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteTaxCategoriesDocument}
            entityName="tax categories"
            requiredPermissions={['DeleteTaxCategory']}
            selection={selection}
            table={table}
        />
    );
};
