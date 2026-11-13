import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
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
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';

import { deleteStockLocationsDocument, stockLocationListQuery } from '../stock-locations.graphql.js';

// Sentinel value for the "discard remaining stock" option, distinct from any real location id.
const DISCARD = '__discard__';

const TRANSFER_TARGETS_QUERY_KEY = 'stockLocationTransferTargets';

type StockLocationListItem = ResultOf<typeof stockLocationListQuery>['stockLocations']['items'][number];

interface DeleteStockLocationsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selection: Array<{ id: string }>;
    onSuccess?: () => void;
}

export function DeleteStockLocationsDialog({
    open,
    onOpenChange,
    selection,
    onSuccess,
}: Readonly<DeleteStockLocationsDialogProps>) {
    const { t } = useLingui();
    const [transferTarget, setTransferTarget] = useState<string>('');
    const count = selection.length;
    const selectLabelId = useId();
    // Defined once so the `items` map and the `SelectItem` children can't drift apart.
    const transferLabel = (name: string) => t`Transfer to ${name}`;

    // The dialog stays mounted, so a choice from a previous delete would otherwise persist. Reset
    // it each time the dialog opens, so a stale target (possibly one now being deleted) can't be sent.
    useEffect(() => {
        if (open) {
            setTransferTarget('');
        }
    }, [open]);

    const selectedIds = new Set(selection.map(s => s.id));

    // Load every stock location so the admin can pick where to move remaining stock. Paginate
    // through all pages rather than capping, so no valid transfer target is silently hidden.
    // The locations being deleted are excluded as they cannot be their own transfer target.
    const { data: allLocations, isLoading } = useQuery({
        queryKey: [TRANSFER_TARGETS_QUERY_KEY],
        queryFn: async () => {
            const pageSize = 100;
            const collected: StockLocationListItem[] = [];
            let totalItems = 0;
            do {
                const result = await api.query(stockLocationListQuery, {
                    options: { skip: collected.length, take: pageSize },
                });
                // Stop on an empty page, otherwise a page that returns nothing while `totalItems`
                // still reports more (permission-filtered results, a clamped `take`) loops forever.
                if (result.stockLocations.items.length === 0) {
                    break;
                }
                collected.push(...result.stockLocations.items);
                totalItems = result.stockLocations.totalItems;
            } while (collected.length < totalItems);
            return collected;
        },
        enabled: open,
    });
    const availableTargets = (allLocations ?? []).filter(l => !selectedIds.has(l.id));

    // Base UI's <Select> needs an `items` map (value → label) to render the selected value's label.
    const selectItems: Record<string, string> = {
        ...Object.fromEntries(availableTargets.map(l => [l.id, transferLabel(l.name)])),
        [DISCARD]: t`Discard remaining stock`,
    };

    const { mutate, isPending } = useMutation({
        mutationFn: api.mutate(deleteStockLocationsDocument),
        onSuccess: (result: ResultOf<typeof deleteStockLocationsDocument>) => {
            const results = result.deleteStockLocations;
            const failed = results.filter(r => r.result !== 'DELETED');
            const deleted = results.length - failed.length;

            // `plural` from @lingui/core/macro is used (not useLingui's `t`) because these are
            // non-JSX messages. Do NOT nest t`...` inside the arms — that breaks extraction.
            if (0 < deleted) {
                toast.success(
                    plural(deleted, {
                        one: `Deleted ${deleted} stock location`,
                        other: `Deleted ${deleted} stock locations`,
                    }),
                );
            }
            if (0 < failed.length) {
                const messages = failed
                    .map(f => f.message)
                    .filter(Boolean)
                    .join(', ');
                toast.error(
                    messages
                        ? plural(failed.length, {
                              one: `Failed to delete ${failed.length} stock location: ${messages}`,
                              other: `Failed to delete ${failed.length} stock locations: ${messages}`,
                          })
                        : plural(failed.length, {
                              one: `Failed to delete ${failed.length} stock location`,
                              other: `Failed to delete ${failed.length} stock locations`,
                          }),
                );
            }
            // Only run cleanup when something was actually deleted. If every item failed (e.g. the
            // last remaining location), keep the dialog open and leave the list untouched.
            // The target list doesn't need invalidating — it is `enabled: open` with the default
            // staleTime of 0, so it refetches every time the dialog is re-opened.
            if (0 < deleted) {
                onSuccess?.();
                onOpenChange(false);
            }
        },
        onError: () => {
            toast.error(
                plural(count, {
                    one: `Failed to delete ${count} stock location`,
                    other: `Failed to delete ${count} stock locations`,
                }),
            );
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
                            Choose what to do with any stock remaining in the{' '}
                            <Plural value={count} one="# stock location" other="# stock locations" /> you are
                            deleting. All selected locations transfer their remaining stock into the single
                            location you choose, or discard it.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <label id={selectLabelId} className="text-sm font-medium">
                            <Trans>Remaining stock</Trans>
                        </label>
                        <Select
                            items={selectItems}
                            value={transferTarget}
                            onValueChange={value => {
                                if (value != null) {
                                    setTransferTarget(value);
                                }
                            }}
                            disabled={isLoading}
                        >
                            <SelectTrigger aria-labelledby={selectLabelId}>
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
                                        {transferLabel(location.name)}
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
