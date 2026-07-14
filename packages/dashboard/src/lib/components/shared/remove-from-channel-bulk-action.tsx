import { useMutation } from '@tanstack/react-query';
import { LayersIcon } from 'lucide-react';
import { toast } from '@/vdb/components/ui/sonner.js';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';

interface RemoveFromChannelBulkActionProps {
    selection: any[];
    table: any;
    entityType: string;
    mutationFn: (variables: any) => Promise<ResultOf<any>>;
    requiredPermissions: string[];
    buildInput: () => Record<string, any>;
    /**
     * Additional callback to run on success, after the standard refetch and reset
     * @param result - The result from the mutation
     */
    onSuccess?: (result?: ResultOf<any>) => void;
    /**
     * Custom success message. If not provided, a default message will be used.
     */
    successMessage?: string;
    /**
     * Custom error message. If not provided, a default message will be used.
     */
    errorMessage?: string;
}

export function RemoveFromChannelBulkAction({
    selection,
    table,
    entityType,
    mutationFn,
    requiredPermissions,
    buildInput,
    onSuccess,
    successMessage,
    errorMessage,
}: Readonly<RemoveFromChannelBulkActionProps>) {
    const { refetchPaginatedList } = usePaginatedList();
    const { activeChannel } = useChannel();
    const { t } = useLingui();
    const selectionLength = selection.length;
    const { mutate } = useMutation({
        mutationFn,
        onSuccess: result => {
            const message =
                successMessage || t`Successfully removed ${selectionLength} ${entityType} from channel`;
            toast.success(message);
            refetchPaginatedList();
            table.resetRowSelection();
            onSuccess?.(result);
        },
        onError: error => {
            const onErrorMessage = error.message;
            const message =
                errorMessage ||
                `Failed to remove ${selectionLength} ${entityType} from channel: ${onErrorMessage}`;
            toast.error(message);
        },
    });

    if (!activeChannel) {
        return null;
    }

    const handleRemove = () => {
        mutate({
            input: buildInput(),
        });
    };

    return (
        <DataTableBulkActionItem
            requiresPermission={requiredPermissions}
            onClick={handleRemove}
            label={<Trans>Remove from channel</Trans>}
            confirmationText={
                <Trans>
                    Are you sure you want to remove {selection.length} {entityType} from the current channel?
                </Trans>
            }
            icon={LayersIcon}
            disabled={activeChannel.code === DEFAULT_CHANNEL_CODE}
        />
    );
}
