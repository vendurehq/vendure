import { useMutation } from '@tanstack/react-query';
import { ReactNode, useCallback, useEffect, useState } from 'react';
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
    /**
     * Whether the values in `additionalFields` are valid. While false, the Assign button is
     * disabled. Defaults to true.
     */
    additionalFieldsValid?: boolean;
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
    additionalFieldsValid = true,
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
        if (selectedChannelIds.length === 0 || !additionalFieldsValid) {
            return;
        }
        mutate();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[425px]"
                // This dialog is opened from a DropdownMenuItem with closeOnClick={false},
                // which keeps the ancestor DropdownMenu mounted and open underneath this
                // dialog. React bubbles synthetic keyboard events through the component
                // tree, not the DOM tree. Without stopping propagation here, the still-open
                // menu's own keydown handling (typeahead and roving focus) intercepts
                // keystrokes typed into the channel search input below — the same defect
                // as #5393 (Collections Move). Escape-to-close is unaffected: Base UI
                // merges its own dismiss handler onto this same element, and that handler
                // still runs.
                onKeyDown={e => e.stopPropagation()}
            >
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
                    <Button onClick={handleAssign} disabled={selectedChannelIds.length === 0 || isPending || !additionalFieldsValid}>
                        <Trans>Assign</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * Hook for managing price factor state in assign-to-channel dialogs.
 *
 * Pass `priceFactorValid` to the dialog's `additionalFieldsValid` prop, so that an invalid
 * factor cannot be submitted.
 */
export function usePriceFactor() {
    // The input keeps the text as typed, so that it can be cleared and intermediate values
    // such as `0.` can be entered. An empty value falls back to the default of 1.
    const [value, setValue] = useState('1');
    // A number input reports text it cannot parse, such as `-` or `1e`, as an empty value.
    // `validity.badInput` tells that apart from a cleared field. It is read in `onInput`,
    // because React skips `onChange` when the reported value does not change.
    const [badInput, setBadInput] = useState(false);
    // The dialog unmounts the input when it closes, so a reopened input is empty even if the
    // previous one held unparseable text. Re-read `badInput` from each newly mounted input.
    const syncBadInput = useCallback((input: HTMLInputElement | null) => {
        if (input) setBadInput(input.validity.badInput);
    }, []);
    const parsed = Number.parseFloat(value);
    const isEmpty = value === '' && !badInput;
    const priceFactorValid = isEmpty || (Number.isFinite(parsed) && parsed >= 0);
    const priceFactor = !isEmpty && priceFactorValid ? parsed : 1;

    const priceFactorField = (
        <div className="grid gap-2">
            <label className="text-sm font-medium">
                <Trans>Price conversion factor</Trans>
            </label>
            <Input
                ref={syncBadInput}
                type="number"
                min="0"
                max="99999"
                step="0.01"
                placeholder="1"
                value={value}
                onChange={e => setValue(e.target.value)}
                onInput={e => setBadInput(e.currentTarget.validity.badInput)}
                aria-invalid={!priceFactorValid}
            />
        </div>
    );

    return { priceFactor, priceFactorField, priceFactorValid };
}
