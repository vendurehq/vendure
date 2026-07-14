import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/vdb/components/ui/alert-dialog.js';
import { Trans } from '@lingui/react/macro';

interface ForceRemoveOptionGroupDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    isPending?: boolean;
}

/**
 * Confirmation shown when an option group cannot be removed normally because it is
 * still in use by existing variants (`ProductOptionInUseError`). Shared by the
 * product-detail badge and the Manage Variants page so the copy and behaviour stay
 * in one place.
 */
export function ForceRemoveOptionGroupDialog({
    open,
    onOpenChange,
    onConfirm,
    isPending,
}: Readonly<ForceRemoveOptionGroupDialogProps>) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <Trans>Force remove option group</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        <Trans>
                            This option group is in use by existing variants. Force removing it may affect
                            those variants. Are you sure?
                        </Trans>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isPending}>
                        <Trans>Cancel</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={isPending}
                        // preventDefault keeps the dialog open while the mutation is in
                        // flight so the disabled state can block a double-submit; the hook
                        // closes it on success.
                        onClick={event => {
                            event.preventDefault();
                            onConfirm();
                        }}
                    >
                        <Trans>Force remove</Trans>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
