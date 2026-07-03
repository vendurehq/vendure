import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';

import { deleteStockLocationsDocument, stockLocationListQuery } from '../stock-locations.graphql.js';

// Sentinel value for the "discard remaining stock" option, distinct from any real location id.
const DISCARD = '__discard__';

const TRANSFER_TARGETS_QUERY_KEY = 'stockLocationTransferTargets';

interface DeleteStockLocationsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selection: Array<{ id: string; name?: string }>;
    onSuccess?: () => void;
}

export function DeleteStockLocationsDialog({
    open,
    onOpenChange,
    selection,
    onSuccess,
}: Readonly<DeleteStockLocationsDialogProps>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const [transferTarget, setTransferTarget] = useState<string>('');
    const count = selection.length;

    const selectedIds = new Set(selection.map(s => s.id));

    // Load stock locations so the admin can pick where to move remaining stock. The locations
    // being deleted are excluded as they cannot be their own transfer target.
    // ponytail: caps the picker at 100 locations; switch to a searchable/paginated picker if
    // installs regularly exceed that.
    const { data, isLoading } = useQuery({
        queryKey: [TRANSFER_TARGETS_QUERY_KEY],
        queryFn: () => api.query(stockLocationListQuery, { options: { take: 100 } }),
        enabled: open,
    });
    const availableTargets = (data?.stockLocations.items ?? []).filter(l => !selectedIds.has(l.id));

    const { mutate, isPending } = useMutation({
        mutationFn: api.mutate(deleteStockLocationsDocument),
        onSuccess: (result: ResultOf<typeof deleteStockLocationsDocument>) => {
            const results = result.deleteStockLocations;
            const failed = results.filter(r => r.result !== 'DELETED');
            const deleted = results.length - failed.length;

            if (0 < deleted) {
                toast.success(t`Deleted ${deleted} stock locations`);
            }
            if (0 < failed.length) {
                const messages = failed
                    .map(f => f.message)
                    .filter(Boolean)
                    .join(', ');
                toast.error(
                    messages
                        ? t`Failed to delete ${failed.length} stock locations: ${messages}`
                        : t`Failed to delete ${failed.length} stock locations`,
                );
            }
            // Drop the cached target list so a deleted location can't be offered as a transfer
            // target the next time the dialog opens.
            queryClient.invalidateQueries({ queryKey: [TRANSFER_TARGETS_QUERY_KEY] });
            onSuccess?.();
            onOpenChange(false);
        },
        onError: () => {
            toast.error(t`Failed to delete ${count} stock locations`);
        },
    });

    const handleDelete = () => {
        if (!transferTarget) {
            return;
        }
        const transferToLocationId = transferTarget === DISCARD ? undefined : transferTarget;
        mutate({
            input: selection.map(s => ({ id: s.id, transferToLocationId })),
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Delete stock locations</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Choose what to do with any stock remaining in the {count} stock location(s) you
                            are deleting. All selected locations transfer their remaining stock into the
                            single location you choose, or discard it.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <label className="text-sm font-medium">
                            <Trans>Remaining stock</Trans>
                        </label>
                        <Select value={transferTarget} onValueChange={setTransferTarget} disabled={isLoading}>
                            <SelectTrigger>
                                <SelectValue
                                    placeholder={
                                        isLoading
                                            ? t`Loading locations…`
                                            : t`Select what to do with remaining stock`
                                    }
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {availableTargets.map(location => (
                                    <SelectItem key={location.id} value={location.id}>
                                        <Trans>Transfer to {location.name}</Trans>
                                    </SelectItem>
                                ))}
                                <SelectItem value={DISCARD}>
                                    <Trans>Discard remaining stock</Trans>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleDelete}
                        disabled={!transferTarget || isPending}
                    >
                        <Trans>Delete</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
