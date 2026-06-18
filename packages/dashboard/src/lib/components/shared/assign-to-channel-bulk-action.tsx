import { LayersIcon } from 'lucide-react';
import { useState } from 'react';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { AssignToChannelDialog } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';

interface AssignToChannelBulkActionProps {
    selection: any[];
    table: any;
    entityType: string;
    mutationFn: (variables: any) => Promise<any>;
    requiredPermissions: string[];
    buildInput: (channelId: string, additionalData?: Record<string, any>) => Record<string, any>;
    additionalFields?: React.ReactNode;
    additionalData?: Record<string, any>;
    /**
     * Additional callback to run on success, after the standard refetch and reset
     */
    onSuccess?: () => void;
}

export function AssignToChannelBulkAction({
    selection,
    table,
    entityType,
    mutationFn,
    requiredPermissions,
    buildInput,
    additionalFields,
    additionalData = {},
    onSuccess,
}: Readonly<AssignToChannelBulkActionProps>) {
    const { refetchPaginatedList } = usePaginatedList();
    const { channels } = useChannel();
    const [dialogOpen, setDialogOpen] = useState(false);

    if (channels.length < 2) {
        return null;
    }

    const handleSuccess = () => {
        refetchPaginatedList();
        table.resetRowSelection();
        onSuccess?.();
    };

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={requiredPermissions}
                onClick={() => setDialogOpen(true)}
                label={<Trans>Assign to channel</Trans>}
                icon={LayersIcon}
                closeOnClick={false}
            />
            <AssignToChannelDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                entityIds={selection.map(s => s.id)}
                entityType={entityType}
                mutationFn={mutationFn}
                onSuccess={handleSuccess}
                buildInput={buildInput}
                additionalFields={additionalFields}
                additionalData={additionalData}
            />
        </>
    );
}
