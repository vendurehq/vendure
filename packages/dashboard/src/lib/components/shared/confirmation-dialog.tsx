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
} from '@/vdb/components/ui/alert-dialog.js';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';

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
    const [open, setOpen] = useState(false);
    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger render={children} onClick={() => setOpen(true)} />

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setOpen(false)}>
                        {cancelText ?? <Trans>Cancel</Trans>}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        type="button"
                        onClick={() => {
                            onConfirm();
                            setOpen(false);
                        }}
                    >
                        {confirmText ?? <Trans>Continue</Trans>}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
