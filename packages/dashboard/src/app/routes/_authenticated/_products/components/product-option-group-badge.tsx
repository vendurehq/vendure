import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { Edit2, Trash2 } from 'lucide-react';

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
    const { remove, forceRemove, inUseGroupId, clearInUseGroup, isPending } = useRemoveOptionGroup(
        productId,
        { onRemoved },
    );

    return (
        <>
            <Badge variant="secondary" className="text-xs">
                <span>{name}</span>
                <Link
                    to={`/option-groups/${id}`}
                    search={{ from: 'product', productId }}
                    className="ml-1.5 inline-flex"
                >
                    <Edit2 className="h-3 w-3" />
                </Link>
                {onRemoved && (
                    <PermissionGuard requires={['UpdateProduct', 'UpdateCatalog']}>
                        <ConfirmationDialog
                            title={t`Remove option group`}
                            description={t`Are you sure you want to remove this option group from the product?`}
                            onConfirm={() => remove(id)}
                        >
                            <button
                                type="button"
                                aria-label={t`Remove option group`}
                                disabled={isPending}
                                className="ml-1 inline-flex"
                            >
                                <Trash2 className="h-3 w-3 text-destructive" />
                            </button>
                        </ConfirmationDialog>
                    </PermissionGuard>
                )}
            </Badge>
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
