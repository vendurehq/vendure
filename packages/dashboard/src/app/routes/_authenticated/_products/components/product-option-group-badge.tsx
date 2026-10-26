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
                <span>{name}</span>
                <Link
                    to={`/option-groups/${id}`}
                    search={{ from: 'product', productId }}
                    className="ml-1.5 inline-flex"
                >
                    <Edit2 className="h-3 w-3" />
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
