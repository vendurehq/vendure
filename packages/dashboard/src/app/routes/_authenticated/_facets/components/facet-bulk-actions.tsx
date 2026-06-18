import { toast } from 'sonner';

import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLingui } from '@lingui/react/macro';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { DuplicateBulkAction } from '../../../../common/duplicate-bulk-action.js';

import {
    assignFacetsToChannelDocument,
    deleteFacetsDocument,
    removeFacetsFromChannelDocument,
} from '../facets.graphql.js';

export const DeleteFacetsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteFacetsDocument}
            entityName="facets"
            requiredPermissions={['DeleteCatalog', 'DeleteFacet']}
            selection={selection}
            table={table}
        />
    );
};

export const AssignFacetsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="facets"
            mutationFn={api.mutate(assignFacetsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateFacet']}
            buildInput={(channelId: string) => ({
                facetIds: selection.map(s => s.id),
                channelId,
            })}
        />
    );
};

export const RemoveFacetsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { activeChannel } = useChannel();
    const { t } = useLingui();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="facets"
            mutationFn={api.mutate(removeFacetsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateFacet']}
            buildInput={() => ({
                facetIds: selection.map(s => s.id),
                channelId: activeChannel?.id,
            })}
            onSuccess={result => {
                const typedResult = result as ResultOf<typeof removeFacetsFromChannelDocument>;
                if (typedResult?.removeFacetsFromChannel) {
                    const errors: string[] = [];

                    for (const item of typedResult.removeFacetsFromChannel) {
                        if ('id' in item) {
                            // Do nothing
                        } else if ('message' in item) {
                            const message = item.message;
                            errors.push(message);
                            toast.error(t`Failed to remove facet from channel: ${message}`);
                        }
                    }

                    const successCount = selection.length - errors.length;

                    if (successCount > 0) {
                        toast.success(t`Successfully removed ${successCount} facets from channel`);
                    }
                }
            }}
        />
    );
};

export const DuplicateFacetsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DuplicateBulkAction
            entityType="Facet"
            duplicatorCode="facet-duplicator"
            requiredPermissions={['UpdateCatalog', 'UpdateFacet']}
            entityName="Facet"
            selection={selection}
            table={table}
        />
    );
};
