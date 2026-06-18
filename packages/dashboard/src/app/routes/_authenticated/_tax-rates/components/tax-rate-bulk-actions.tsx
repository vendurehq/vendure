import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteTaxRatesDocument } from '../tax-rates.graphql.js';

export const DeleteTaxRatesBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteTaxRatesDocument}
            entityName="tax rates"
            requiredPermissions={['DeleteTaxRate']}
            selection={selection}
            table={table}
        />
    );
};
