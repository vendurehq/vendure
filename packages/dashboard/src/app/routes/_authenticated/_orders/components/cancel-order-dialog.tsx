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
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { cancelOrderDocument } from '../orders.graphql.js';

interface CancelOrderDialogProps {
    orderId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettled?: () => void;
}

export function CancelOrderDialog({
    orderId,
    open,
    onOpenChange,
    onSettled,
}: Readonly<CancelOrderDialogProps>) {
    const { t } = useLingui();
    const cancelOrderMutation = useMutation({
        mutationFn: api.mutate(cancelOrderDocument),
    });

    const handleConfirm = async () => {
        try {
            const { cancelOrder } = await cancelOrderMutation.mutateAsync({ input: { orderId } });
            if (cancelOrder.__typename !== 'Order') {
                toast.error(t`Failed to cancel order`, { description: cancelOrder.message });
                onSettled?.();
                return;
            }
            toast.success(t`Order cancelled`);
            onOpenChange(false);
            onSettled?.();
        } catch (error) {
            toast.error(t`Failed to cancel order`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        <Trans>Cancel order</Trans>
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        <Trans>
                            This cancels every item in the order and releases the allocated stock. No payment
                            is refunded or cancelled.
                        </Trans>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={cancelOrderMutation.isPending}>
                        <Trans>Keep order</Trans>
                    </AlertDialogCancel>
                    <AlertDialogAction
                        disabled={cancelOrderMutation.isPending}
                        onClick={() => void handleConfirm()}
                    >
                        <Trans>Cancel order</Trans>
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
