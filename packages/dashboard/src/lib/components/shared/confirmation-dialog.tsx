import { Trans } from '@lingui/react/macro';
import { ConfirmDialog } from '@vendure-io/ui/components/molecules/confirm-dialog';

export function ConfirmationDialog({
    title,
    description,
    onConfirm,
    children,
    confirmText,
    cancelText,
}: {
    title: string;
    description: string;
    onConfirm: () => void;
    confirmText?: string;
    cancelText?: string;
    children: React.ReactElement;
}) {
    return (
        <ConfirmDialog
            title={title}
            description={description}
            onConfirm={onConfirm}
            confirmLabel={confirmText ?? <Trans>Continue</Trans>}
            cancelLabel={cancelText ?? <Trans>Cancel</Trans>}
        >
            {children}
        </ConfirmDialog>
    );
}
