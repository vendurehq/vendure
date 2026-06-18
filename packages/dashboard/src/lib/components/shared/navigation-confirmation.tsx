import { Trans } from '@lingui/react/macro';
import { useBlocker } from '@tanstack/react-router';
import { UseFormReturn } from 'react-hook-form';

import { Button } from '../ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '../ui/dialog.js';

export interface NavigationConfirmationProps {
    form: UseFormReturn<any>;
}

/**
 * Navigation confirmation dialog that blocks navigation when the form is dirty.
 */
export function NavigationConfirmation(props: Readonly<NavigationConfirmationProps>) {
    const { proceed, reset, status } = useBlocker({
        shouldBlockFn: args => {
            // When a new entity is being created, we don't want to block navigation
            // to the newly-created entity page.
            const isNavigatingToNewlyCreatedEntity =
                args.current.fullPath === args.next.fullPath &&
                args.current.params.id === 'new' &&
                args.next.params.id !== 'new';
            if (isNavigatingToNewlyCreatedEntity) {
                return false;
            }
            return props.form.formState.isDirty;
        },
        withResolver: true,
        enableBeforeUnload: () => props.form.formState.isDirty,
    });
    return (
        <Dialog open={status === 'blocked'} onOpenChange={reset}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Confirm navigation</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Are you sure you want to navigate away from this page? Any unsaved changes will be
                            lost.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={reset}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button type="button" onClick={proceed}>
                        <Trans>Confirm</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
