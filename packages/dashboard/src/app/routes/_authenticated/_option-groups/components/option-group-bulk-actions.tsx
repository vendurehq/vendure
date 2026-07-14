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

export const DeleteOptionGroupsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteOptionGroupsDocument}
            entityName="option groups"
            requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
            selection={selection}
            table={table}
        />
    );
};

export const AssignOptionGroupsToChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    table,
}) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="option groups"
            mutationFn={api.mutate(assignOptionGroupsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={(channelId: string) => ({
                productOptionGroupIds: selection.map(s => s.id),
                channelId,
            })}
        />
    );
};

export const RemoveOptionGroupsFromChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    table,
}) => {
    const { activeChannel } = useChannel();
    const { t } = useLingui();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="option groups"
            mutationFn={api.mutate(removeOptionGroupsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={() => ({
                productOptionGroupIds: selection.map(s => s.id),
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

                    const successCount = selection.length - errors.length;

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
