import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '../ui/alert-dialog.js';
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
    confirmationText?: React.ReactNode;
    onClick: () => void;
    className?: string;
    requiresPermission?: string[];
    disabled?: boolean;
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
 *       confirmationText={<Trans>Are you sure?</Trans>}
 *       icon={Check}
 *       className="text-destructive"
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
    className,
    onClick,
    requiresPermission,
    disabled,
    closeOnClick,
}: Readonly<DataTableBulkActionItemProps>) {
    const [isOpen, setIsOpen] = useState(false);
    const { hasPermissions } = usePermissions();
    const userHasPermission = hasPermissions(requiresPermission ?? []);

    const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (!userHasPermission) {
            return;
        }
        if (confirmationText) {
            setIsOpen(true);
        } else {
            onClick?.();
        }
    };

    const handleConfirm = () => {
        setIsOpen(false);
        onClick?.();
    };

    const handleCancel = () => {
        setIsOpen(false);
    };

    if (confirmationText) {
        return (
            <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
                <AlertDialogTrigger nativeButton={false} render={<DropdownMenuItem closeOnClick={false} onClick={handleClick} disabled={!userHasPermission || disabled} />}>
                        {Icon && <Icon className={cn('mr-1 h-4 w-4', className)} />}
                        <span className={cn('text-sm', className)}>
                            <Trans>{label}</Trans>
                        </span>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            <Trans>Confirm Action</Trans>
                        </AlertDialogTitle>
                        <AlertDialogDescription>{confirmationText}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleCancel}>
                            <Trans>Cancel</Trans>
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirm}>
                            <Trans>Continue</Trans>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    }

    return (
        <DropdownMenuItem closeOnClick={closeOnClick} onClick={handleClick}>
            {Icon && <Icon className={cn('mr-1 h-4 w-4', className)} />}
            <span className={cn('text-sm', className)}>
                <Trans>{label}</Trans>
            </span>
        </DropdownMenuItem>
    );
}
