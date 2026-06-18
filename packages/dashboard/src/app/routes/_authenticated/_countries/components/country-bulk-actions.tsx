import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteCountriesDocument } from '../countries.graphql.js';

export const DeleteCountriesBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteCountriesDocument}
            entityName="countries"
            requiredPermissions={['DeleteCountry']}
            selection={selection}
            table={table}
        />
    );
};
