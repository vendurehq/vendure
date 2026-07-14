import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { removeOptionGroupFromProductDocument } from '../products.graphql.js';

type RemoveOptionGroupResult = ResultOf<
    typeof removeOptionGroupFromProductDocument
>['removeOptionGroupFromProduct'];

export interface UseRemoveOptionGroupOptions {
    /** Called after a group is successfully (force-)removed, e.g. to refetch. */
    onRemoved?: () => void;
}

/**
 * @description
 * Shared logic for removing an option group from a product (issue #4703). Owns the
 * single mutation, the typed `ProductOptionInUseError` discrimination, the toasts,
 * and the "in use" state that drives the force-remove confirmation. Consumers own
 * only their trigger UI and the {@link ForceRemoveOptionGroupDialog} placement.
 *
 * `remove` handles the interactive single-group flow (surfacing the force dialog on
 * `ProductOptionInUseError`); `removeOptionGroupAsync` is the low-level typed
 * primitive for batch callers that inspect the result themselves.
 */
export function useRemoveOptionGroup(productId: string, options?: UseRemoveOptionGroupOptions) {
    const { t } = useLingui();
    // The group that hit ProductOptionInUseError and is awaiting force confirmation.
    // When a single hook instance is shared across many groups (the Manage Variants
    // page), this also identifies which group's force dialog is open. Per-instance
    // callers (the detail-page badge) only ever see null or their own group id.
    const [inUseGroupId, setInUseGroupId] = useState<string | null>(null);
    const mutation = useMutation({ mutationFn: api.mutate(removeOptionGroupFromProductDocument) });

    const removeOptionGroupAsync = (optionGroupId: string, force = false): Promise<RemoveOptionGroupResult> =>
        mutation
            .mutateAsync({ productId, optionGroupId, force })
            .then(result => result.removeOptionGroupFromProduct);

    const remove = async (optionGroupId: string) => {
        try {
            const result = await removeOptionGroupAsync(optionGroupId);
            if (result.__typename === 'ProductOptionInUseError') {
                setInUseGroupId(optionGroupId);
                return;
            }
            toast.success(t`Option group removed`);
            options?.onRemoved?.();
        } catch (error) {
            toast.error(t`Failed to remove option group`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    };

    const forceRemove = async () => {
        if (!inUseGroupId) {
            return;
        }
        try {
            await removeOptionGroupAsync(inUseGroupId, true);
            setInUseGroupId(null);
            toast.success(t`Option group removed`);
            options?.onRemoved?.();
        } catch (error) {
            // Keep the dialog open on failure so the user can retry the force-remove
            // without restarting the whole flow; only a success clears `inUseGroupId`.
            toast.error(t`Failed to remove option group`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    };

    return {
        /** Remove a single group, surfacing the force dialog if it is in use. */
        remove,
        /** Confirm force-removal of the group currently in `inUseGroupId`. */
        forceRemove,
        /** Typed remove primitive for batch callers that inspect the result. */
        removeOptionGroupAsync,
        /** Non-null while the force-remove dialog should be shown for that group. */
        inUseGroupId,
        clearInUseGroup: () => setInUseGroupId(null),
        isPending: mutation.isPending,
    };
}
