import { useMutation } from '@tanstack/react-query';
import { ReactNode, useEffect, useState } from 'react';
import { toast } from '@/vdb/components/ui/sonner.js';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { MultiSelect } from '@/vdb/components/shared/multi-select.js';
import { assignToChannels } from '@/vdb/components/shared/assign-to-channels.js';
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
import { plural } from '@lingui/core/macro';
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
    const { channels, activeChannel } = useChannel();
    const entityIdsLength = entityIds.length;

    useEffect(() => {
        if (!open) setSelectedChannelIds([]);
    }, [open]);

    // Filter out the currently active channel from available options
    const availableChannels = channels.filter(channel => channel.id !== activeChannel?.id);

    const selectItems = availableChannels.map(ch => ({
        value: ch.id,
        label: ch.code,
        display: <ChannelCodeLabel code={ch.code} />,
    }));

    const { mutate, isPending } = useMutation({
        mutationFn: () =>
            assignToChannels(
                selectedChannelIds,
                channelId => buildInput(channelId, additionalData),
                mutationFn,
            ),
        onSuccess: ({ succeeded, failed }) => {
            if (failed.length) {
                console.error('Failed to assign to channels', failed);
            }

            const failedCodes = failed
                .map(f => channels.find(c => c.id === f.channelId)?.code ?? f.channelId)
                .join(', ');

            if (failed.length === 0) {
                toast.success(
                    plural(succeeded.length, {
                        one: `Assigned ${entityIdsLength} ${entityType} to ${succeeded.length} channel`,
                        other: `Assigned ${entityIdsLength} ${entityType} to ${succeeded.length} channels`,
                    }),
                );
                setSelectedChannelIds([]);
                onSuccess?.();
                onOpenChange(false);
            } else if (succeeded.length === 0) {
                toast.error(
                    plural(failed.length, {
                        one: `Failed to assign ${entityIdsLength} ${entityType} to ${failed.length} channel`,
                        other: `Failed to assign ${entityIdsLength} ${entityType} to ${failed.length} channels`,
                    }),
                    { description: failedCodes },
                );
            } else {
                toast.warning(
                    plural(succeeded.length, {
                        one: `Assigned ${entityIdsLength} ${entityType} to ${succeeded.length} channel`,
                        other: `Assigned ${entityIdsLength} ${entityType} to ${succeeded.length} channels`,
                    }),
                    { description: t`Failed for: ${failedCodes}` },
                );
                // Keep the dialog open and narrow the selection to the failures, so retrying
                // is one click and doesn't re-assign the channels that already succeeded.
                setSelectedChannelIds(failed.map(f => f.channelId));
                onSuccess?.();
            }
        },
        onError: () => {
            toast.error(t`Failed to assign ${entityIdsLength} ${entityType} to the selected channels`);
        },
    });

    const handleAssign = () => {
        if (selectedChannelIds.length === 0) {
            return;
        }
        mutate();
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
                            showSearch
                            className="w-full"
                        />
                    </div>
                    {additionalFields}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleAssign} disabled={selectedChannelIds.length === 0 || isPending}>
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
