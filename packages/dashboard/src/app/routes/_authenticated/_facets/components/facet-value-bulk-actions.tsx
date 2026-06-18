import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';

import { deleteFacetValuesDocument } from '../facets.graphql.js';

export const DeleteFacetValuesBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteFacetValuesDocument}
            entityName="facets"
            requiredPermissions={['DeleteCatalog', 'DeleteFacet']}
            selection={selection}
            table={table}
        />
    );
};
