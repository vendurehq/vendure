import { ReactNode, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/vdb/components/ui/sonner.js';
import { Plus } from 'lucide-react';

import { ChannelChip } from '@/vdb/components/shared/channel-chip.js';
import { AssignToChannelDialog } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import type { SimpleChannel } from '@/vdb/providers/channel-provider.js';

interface AssignedChannelsProps {
    channels: SimpleChannel[];
    entityId: string;
    entityType: string;
    canUpdate?: boolean;
    assignMutationFn: (variables: any) => Promise<unknown>;
    removeMutationFn: (variables: any) => Promise<unknown>;
    buildRemoveInput: (entityId: string, channelId: string) => Record<string, unknown>;
    buildAssignInput: (entityId: string, channelId: string) => Record<string, unknown>;
    additionalAssignFields?: ReactNode;
    /** Query key prefix to invalidate after channel changes. Defaults to `['DetailPage']`. */
    queryKeyScope?: unknown[];
}

export function AssignedChannels({
    channels,
    entityId,
    entityType,
    canUpdate = true,
    assignMutationFn,
    removeMutationFn,
    buildRemoveInput,
    buildAssignInput,
    additionalAssignFields,
    queryKeyScope = ['DetailPage'],
}: Readonly<AssignedChannelsProps>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { activeChannel, channels: allChannels } = useChannel();
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);

    const { mutate: removeFromChannel, isPending: isRemoving } = useMutation({
        mutationFn: removeMutationFn,
        onSuccess: () => {
            toast.success(t`Successfully removed ${entityType} from channel`);
            queryClient.invalidateQueries({ queryKey: queryKeyScope });
        },
        onError: () => {
            toast.error(t`Failed to remove ${entityType} from channel`);
        },
    });

    function onRemoveHandler(channelId: string) {
        if (channelId === activeChannel?.id) {
            toast.error(t`Cannot remove from active channel`);
            return;
        }
        removeFromChannel({
            input: buildRemoveInput(entityId, channelId),
        });
    }

    const handleAssignSuccess = () => {
        queryClient.invalidateQueries({ queryKey: queryKeyScope });
        setAssignDialogOpen(false);
    };

    const availableChannels = allChannels.filter(ch => !channels.map(c => c.id).includes(ch.id));
    const showAddButton = canUpdate && availableChannels.length > 0;

    return (
        <>
            <div className="flex flex-wrap gap-1 mb-2">
                {channels
                    .filter(c => c.code !== DEFAULT_CHANNEL_CODE)
                    .map((channel: SimpleChannel) => (
                        <ChannelChip
                            key={channel.id}
                            channel={channel}
                            removable={canUpdate && channel.id !== activeChannel?.id}
                            onRemove={onRemoveHandler}
                        />
                    ))}
            </div>
            {showAddButton && (
                <>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAssignDialogOpen(true)}
                        disabled={isRemoving}
                    >
                        <Plus className="h-4 w-4 mr-1" />
                        <Trans>Assign to channel</Trans>
                    </Button>
                    <AssignToChannelDialog
                        entityType={entityType}
                        open={assignDialogOpen}
                        onOpenChange={setAssignDialogOpen}
                        entityIds={[entityId]}
                        mutationFn={assignMutationFn}
                        onSuccess={handleAssignSuccess}
                        buildInput={(channelId: string) => buildAssignInput(entityId, channelId)}
                        additionalFields={additionalAssignFields}
                    />
                </>
            )}
        </>
    );
}
