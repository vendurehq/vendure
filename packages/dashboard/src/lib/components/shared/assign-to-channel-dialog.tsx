import { toast } from '@/vdb/components/ui/sonner.js';
import { ReactNode, useEffect, useState } from 'react';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { MultiSelect } from '@/vdb/components/shared/multi-select.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';

import { useChannel } from '@/vdb/hooks/use-channel.js';

interface AssignToChannelDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    entityIds: string[];
    entityType: string;
    mutationFn: (variables: any) => Promise<ResultOf<any>>;
    onSuccess?: () => void;
    /**
     * Function to build the input object for the mutation
     * @param channelId - The selected channel ID
     * @param additionalData - Any additional data (like priceFactor for products)
     * @returns The input object for the mutation
     */
    buildInput: (channelId: string, additionalData?: Record<string, any>) => Record<string, any>;
    /**
     * Optional additional form fields to render
     */
    additionalFields?: ReactNode;
    /**
     * Optional additional data to pass to buildInput
     */
    additionalData?: Record<string, any>;
}

export function AssignToChannelDialog({
    open,
    onOpenChange,
    entityIds,
    entityType,
    mutationFn,
    onSuccess,
    buildInput,
    additionalFields,
    additionalData = {},
}: Readonly<AssignToChannelDialogProps>) {
    const { t } = useLingui();
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [isAssigning, setIsAssigning] = useState(false);
    const { channels, activeChannel } = useChannel();
    const entityIdsLength = entityIds.length;

    useEffect(() => {
        if (!open) setSelectedChannelIds([]);
    }, [open]);

    // Filter out the currently selected channel from available options
    const availableChannels = channels.filter(channel => channel.id !== activeChannel?.id);

    const selectItems = availableChannels.map(ch => ({
        value: ch.id,
        label: ch.code,
        display: <ChannelCodeLabel code={ch.code} />,
    }));

    const handleAssign = async () => {
        setIsAssigning(true);
        try {
            const results = await Promise.allSettled(
                selectedChannelIds.map(channelId =>
                    mutationFn({ input: buildInput(channelId, additionalData) }),
                ),
            );

            const failedChannelIds = results.flatMap((r, i) =>
                r.status === 'rejected' ? [selectedChannelIds[i]] : [],
            );
            const succeededCount = results.length - failedChannelIds.length;

            if (succeededCount > 0) {
                onSuccess?.();
            }

            if (failedChannelIds.length === 0) {
                toast.success(
                    t`Successfully assigned ${entityIdsLength} ${entityType} to ${selectedChannelIds.length} channels`,
                );
                onOpenChange(false);
            } else {
                const firstRejected = results.find(r => r.status === 'rejected');
                const firstReason = firstRejected?.status === 'rejected' ? firstRejected.reason : undefined;
                const description = firstReason instanceof Error ? firstReason.message : undefined;
                setSelectedChannelIds(failedChannelIds);
                toast.error(
                    t`Failed to assign ${entityIdsLength} ${entityType} to ${failedChannelIds.length} of ${selectedChannelIds.length} channels`,
                    { description },
                );
            }
        } finally {
            setIsAssigning(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Assign {entityType} to channels</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Select channels to assign {entityIds.length} {entityType} to
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <label className="text-sm font-medium">
                            <Trans>Channel</Trans>
                        </label>
                        <MultiSelect
                            multiple={true}
                            items={selectItems}
                            value={selectedChannelIds}
                            onChange={setSelectedChannelIds}
                            placeholder={t`Select one or more channels`}
                            searchPlaceholder={t`Search channels...`}
                            className="w-full"
                        />
                    </div>
                    {additionalFields}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleAssign} disabled={selectedChannelIds.length === 0 || isAssigning}>
                        <Trans>Assign</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Hook for managing price factor state in assign-to-channel dialogs
 */
export function usePriceFactor() {
    const [priceFactor, setPriceFactor] = useState<number>(1);

    const priceFactorField = (
        <div className="grid gap-2">
            <label className="text-sm font-medium">
                <Trans>Price conversion factor</Trans>
            </label>
            <Input
                type="number"
                min="0"
                max="99999"
                step="0.01"
                value={priceFactor}
                onChange={e => setPriceFactor(Number.parseFloat(e.target.value) || 1)}
            />
        </div>
    );

    return { priceFactor, priceFactorField };
}
