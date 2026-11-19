import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Chip } from '@vendure-io/ui/components/molecules/chip';
import { ConfirmDialog } from '@vendure-io/ui/components/molecules/confirm-dialog';
import { Edit2 } from 'lucide-react';
import { useState } from 'react';

import { useRemoveOptionGroup } from '../hooks/use-remove-option-group.js';
import { ForceRemoveOptionGroupDialog } from './force-remove-option-group-dialog.js';

interface ProductOptionGroupBadgeProps {
    id: string;
    name: string;
    productId: string;
    /**
     * When provided, the badge renders a remove control that detaches the option
     * group from the product (issue #4703 — a wrongly-added option group could
     * not be removed from the product detail page). Called after a successful
     * removal so the parent can refresh.
     */
    onRemoved?: () => void;
}

export function ProductOptionGroupBadge({
    id,
    name,
    productId,
    onRemoved,
}: Readonly<ProductOptionGroupBadgeProps>) {
    const { t } = useLingui();
    const { hasPermissions } = usePermissions();
    const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
    const { remove, forceRemove, inUseGroupId, clearInUseGroup, isPending } = useRemoveOptionGroup(
        productId,
        { onRemoved },
    );
    const canRemove = onRemoved != null && hasPermissions(['UpdateProduct', 'UpdateCatalog']);

    return (
        <>
            <Chip
                variant="default"
                className="text-xs"
                onRemove={canRemove ? () => setRemoveDialogOpen(true) : undefined}
                removeLabel={canRemove ? t`Remove option group ${name}` : undefined}
                disabled={canRemove && isPending}
            >
                {/* The name and the pencil are one link: a 12px pencil on its own sits too
                    close to the remove button to tap at 390 wide. */}
                <Link
                    to={`/option-groups/${id}`}
                    search={{ from: 'product', productId }}
                    className="group/edit inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    aria-label={t`Edit option group ${name}`}
                >
                    <span className="truncate">{name}</span>
                    <Edit2 className="size-3 shrink-0 text-current/70 group-hover/edit:text-current" />
                </Link>
            </Chip>
            {canRemove && (
                <ConfirmDialog
                    open={removeDialogOpen}
                    onOpenChange={setRemoveDialogOpen}
                    title={t`Remove option group`}
                    description={t`Are you sure you want to remove this option group from the product?`}
                    onConfirm={() => remove(id)}
                />
            )}
            <ForceRemoveOptionGroupDialog
                open={inUseGroupId === id}
                onOpenChange={open => {
                    if (!open) {
                        clearInUseGroup();
                    }
                }}
                onConfirm={forceRemove}
                isPending={isPending}
            />
        </>
    );
}
