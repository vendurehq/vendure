import { Trans } from '@lingui/react/macro';
import { ConfirmDialog } from '@vendure-io/ui/components/molecules/confirm-dialog';

export function ConfirmationDialog({
    title,
    description,
    onConfirm,
    children,
    confirmText,
    cancelText,
    destructive,
}: {
    title: string;
    description: string;
    onConfirm: () => void | Promise<void>;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
    children: React.ReactElement;
}) {
    return (
        <ConfirmDialog
            title={title}
            description={description}
            onConfirm={onConfirm}
            confirmLabel={confirmText ?? <Trans>Continue</Trans>}
            cancelLabel={cancelText ?? <Trans>Cancel</Trans>}
            variant={destructive ? 'destructive' : 'default'}
        >
            {children}
        </ConfirmDialog>
    );
}
