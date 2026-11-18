import { ConfirmDialog } from '@/vdb/components/ui/confirm-dialog.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { Trans } from '@lingui/react/macro';
import { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenuItem } from '../ui/dropdown-menu.js';

/**
 * @description
 *
 * @docsCategory list-views
 * @docsPage bulk-actions
 * @since 3.4.0
 */
export interface DataTableBulkActionItemProps {
    label: React.ReactNode;
    icon?: LucideIcon;
    /**
     * @description
     * When set, a click opens a confirm dialog with this text as its description,
     * and the action runs on confirm.
     */
    confirmationText?: React.ReactNode;
    /**
     * @description
     * The title of the confirm dialog. Name the action and the item, for example
     * "Delete 3 products?". Defaults to "Confirm action".
     *
     * @since 3.8.0
     */
    confirmationTitle?: React.ReactNode;
    /**
     * @description
     * The label of the confirm button. Name the action, for example "Delete".
     * Defaults to "Confirm".
     *
     * @since 3.8.0
     */
    confirmLabel?: React.ReactNode;
    /**
     * @description
     * `destructive` colours the item red and gives its confirm dialog a red
     * confirm button that does not take the focus.
     *
     * @default 'default'
     * @since 3.8.0
     */
    variant?: 'default' | 'destructive';
    onClick: () => void;
    className?: string;
    requiresPermission?: string[];
    disabled?: boolean;
    /**
     * @description
     * Why the item is disabled, shown under its label while `disabled` is set.
     *
     * @since 3.8.0
     */
    disabledReason?: React.ReactNode;
    closeOnClick?: boolean;
}

/**
 * @description
 * A component that should be used to implement any bulk actions for list pages & data tables.
 *
 * @example
 * ```tsx
 * import { Trans } from '@lingui/react/macro';
 * import { DataTableBulkActionItem, BulkActionComponent } from '\@vendure/dashboard';
 * import { Check } from 'lucide-react';
 *
 * export const MyBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
 *
 *   return (
 *     <DataTableBulkActionItem
 *       requiresPermission={['ReadMyCustomEntity']}
 *       onClick={() => {
 *         console.log('Selected items:', selection);
 *       }}
 *       label={<Trans>Delete</Trans>}
 *       confirmationTitle={<Trans>Delete {selection.length} items?</Trans>}
 *       confirmationText={<Trans>This cannot be undone.</Trans>}
 *       confirmLabel={<Trans>Delete</Trans>}
 *       icon={Check}
 *       variant="destructive"
 *     />
 *   );
 * }
 * ```
 *
 * @docsCategory list-views
 * @docsPage bulk-actions
 * @since 3.4.0
 */
export function DataTableBulkActionItem({
    label,
    icon: Icon,
    confirmationText,
    confirmationTitle,
    confirmLabel,
    variant = 'default',
    className,
    onClick,
    requiresPermission,
    disabled,
    disabledReason,
    closeOnClick,
}: Readonly<DataTableBulkActionItemProps>) {
    const [isOpen, setIsOpen] = useState(false);
    const { hasPermissions } = usePermissions();
    const userHasPermission = hasPermissions(requiresPermission ?? []);
    const isDisabled = !userHasPermission || !!disabled;

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isDisabled) {
            return;
        }
        if (confirmationText) {
            setIsOpen(true);
        } else {
            onClick?.();
        }
    };

    // The item stays a plain menu item, so it keeps the `menuitem` role and the
    // menu's focus handling. The confirm dialog is controlled from its click.
    const item = (
        <DropdownMenuItem
            variant={variant}
            closeOnClick={confirmationText ? false : closeOnClick}
            onClick={handleClick}
            disabled={isDisabled}
            className={className}
        >
            {Icon && <Icon />}
            {disabled && disabledReason ? (
                <span className="flex flex-col">
                    <span>{label}</span>
                    <span className="text-xs">{disabledReason}</span>
                </span>
            ) : (
                label
            )}
        </DropdownMenuItem>
    );

    if (!confirmationText) {
        return item;
    }

    return (
        <>
            {item}
            <ConfirmDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                variant={variant}
                icon={Icon && variant === 'destructive' ? <Icon /> : undefined}
                title={confirmationTitle ?? <Trans>Confirm action</Trans>}
                description={confirmationText}
                confirmLabel={confirmLabel ?? <Trans>Confirm</Trans>}
                cancelLabel={<Trans>Cancel</Trans>}
                onConfirm={() => onClick?.()}
            />
        </>
    );
}
