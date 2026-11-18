import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLingui } from '@lingui/react/macro';
import { toast } from 'sonner';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';

import {
    assignOptionGroupsToChannelDocument,
    deleteOptionGroupsDocument,
    removeOptionGroupsFromChannelDocument,
} from '../option-groups.graphql.js';

export const DeleteOptionGroupsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteOptionGroupsDocument}
            entityName="option groups"
            requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};

export const AssignOptionGroupsToChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    selectedRowIds,
    table,
}) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="option groups"
            mutationFn={api.mutate(assignOptionGroupsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={(channelId: string) => ({
                productOptionGroupIds: selectedRowIds,
                channelId,
            })}
        />
    );
};

export const RemoveOptionGroupsFromChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    selectedRowIds,
    table,
}) => {
    const { activeChannel } = useChannel();
    const { t } = useLingui();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="option groups"
            mutationFn={api.mutate(removeOptionGroupsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={() => ({
                productOptionGroupIds: selectedRowIds,
                channelId: activeChannel?.id,
            })}
            onSuccess={result => {
                const typedResult = result as ResultOf<typeof removeOptionGroupsFromChannelDocument>;
                if (typedResult?.removeProductOptionGroupsFromChannel) {
                    const errors: string[] = [];

                    for (const item of typedResult.removeProductOptionGroupsFromChannel) {
                        if ('id' in item) {
                            // Success
                        } else if ('message' in item) {
                            const message = item.message;
                            errors.push(message);
                            toast.error(
                                t`Failed to remove option group from channel: ${message}`,
                            );
                        }
                    }

                    const successCount = selectedRowIds.length - errors.length;

                    if (successCount > 0) {
                        toast.success(
                            t`Successfully removed ${successCount} option groups from channel`,
                        );
                    }
                }
            }}
        />
    );
};
