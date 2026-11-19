import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/vdb/components/ui/collapsible.js';
import {
    DescriptionDetail,
    DescriptionItem,
    DescriptionList,
    DescriptionListItem,
    DescriptionTerm,
} from '@/vdb/components/ui/description-list.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { cn } from '@/vdb/lib/utils.js';
import { isDestructiveTransition, orderStateDictionary } from '@/vdb/utils/state-type.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
    cancelPaymentDocument,
    paymentWithRefundsFragment,
    settlePaymentDocument,
    settleRefundDocument,
    transitionPaymentToStateDocument,
} from '../orders.graphql.js';

import { SettleRefundDialog } from './settle-refund-dialog.js';
import { StateTransitionAction, StateTransitionControl } from './state-transition-control.js';

type PaymentDetailsProps = {
    payment: ResultOf<typeof paymentWithRefundsFragment>;
    currencyCode: string;
    onSuccess?: () => void;
};

export function PaymentDetails({ payment, currencyCode, onSuccess }: Readonly<PaymentDetailsProps>) {
    const { formatCurrency, formatDate } = useLocalFormat();
    const { t } = useLingui();
    const { getTranslatedPaymentState, getTranslatedRefundState } = useDynamicTranslations();
    const [settleRefundDialogOpen, setSettleRefundDialogOpen] = useState(false);
    const [selectedRefundId, setSelectedRefundId] = useState<string | null>(null);

    const settlePaymentMutation = useMutation({
        mutationFn: api.mutate(settlePaymentDocument),
        onSuccess: (result: ResultOf<typeof settlePaymentDocument>) => {
            if (result.settlePayment.__typename === 'Payment') {
                toast.success(t`Payment settled successfully`);
                onSuccess?.();
            } else {
                toast.error(result.settlePayment.message ?? t`Failed to settle payment`);
            }
        },
        onError: () => {
            toast.error(t`Failed to settle payment`);
        },
    });

    const transitionPaymentMutation = useMutation({
        mutationFn: api.mutate(transitionPaymentToStateDocument),
        onSuccess: (result: ResultOf<typeof transitionPaymentToStateDocument>) => {
            if (result.transitionPaymentToState.__typename === 'Payment') {
                toast.success(t`Payment state updated successfully`);
                onSuccess?.();
            } else {
                toast.error(result.transitionPaymentToState.message ?? t`Failed to update payment state`);
            }
        },
        onError: () => {
            toast.error(t`Failed to update payment state`);
        },
    });

    const cancelPaymentMutation = useMutation({
        mutationFn: api.mutate(cancelPaymentDocument),
        onSuccess: (result: ResultOf<typeof cancelPaymentDocument>) => {
            if (result.cancelPayment.__typename === 'Payment') {
                toast.success(t`Payment cancelled successfully`);
                onSuccess?.();
            } else {
                toast.error(result.cancelPayment.message ?? t`Failed to cancel payment`);
            }
        },
        onError: () => {
            toast.error(t`Failed to cancel payment`);
        },
    });

    const settleRefundMutation = useMutation({
        mutationFn: api.mutate(settleRefundDocument),
        onSuccess: (result: ResultOf<typeof settleRefundDocument>) => {
            if (result.settleRefund.__typename === 'Refund') {
                toast.success(t`Refund settled successfully`);
                onSuccess?.();
                setSettleRefundDialogOpen(false);
            } else {
                toast.error(result.settleRefund.message ?? t`Failed to settle refund`);
            }
        },
        onError: () => {
            toast.error(t`Failed to settle refund`);
        },
    });

    const handlePaymentStateTransition = (state: string) => {
        if (state === 'Cancelled') {
            cancelPaymentMutation.mutate({ id: payment.id });
        } else {
            transitionPaymentMutation.mutate({ id: payment.id, state });
        }
    };

    const handleSettlePayment = () => {
        settlePaymentMutation.mutate({ id: payment.id });
    };

    const handleSettleRefund = (refundId: string) => {
        setSelectedRefundId(refundId);
        setSettleRefundDialogOpen(true);
    };

    const handleSettleRefundConfirm = (transactionId: string) => {
        if (selectedRefundId) {
            settleRefundMutation.mutate({
                input: {
                    id: selectedRefundId,
                    transactionId,
                },
            });
        }
    };

    const nextOtherStates = (): string[] => {
        if (!payment.nextStates) {
            return [];
        }
        return payment.nextStates.filter(s => s !== 'Settled' && s !== 'Error');
    };

    const getPaymentActions = () => {
        const actions: StateTransitionAction[] = [];

        if (payment.nextStates?.includes('Settled')) {
            actions.push({
                label: t`Settle payment`,
                onClick: handleSettlePayment,
                tone: 'success',
                disabled: settlePaymentMutation.isPending,
            });
        }

        nextOtherStates().forEach(state => {
            actions.push({
                label:
                    state === 'Cancelled'
                        ? t`Cancel payment`
                        : t`Transition to ${getTranslatedPaymentState(state)}`,
                tone: orderStateDictionary.toneFor(state),
                destructive: isDestructiveTransition(state),
                onClick: () => handlePaymentStateTransition(state),
                disabled: transitionPaymentMutation.isPending || cancelPaymentMutation.isPending,
            });
        });

        return actions;
    };

    return (
        <>
            <div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="sm:col-start-2 sm:row-start-1 sm:justify-self-end">
                        <StateTransitionControl
                            currentState={payment.state}
                            statesTranslationFunction={getTranslatedPaymentState}
                            actions={getPaymentActions()}
                            isLoading={
                                settlePaymentMutation.isPending ||
                                transitionPaymentMutation.isPending ||
                                cancelPaymentMutation.isPending
                            }
                        />
                    </div>
                    <DescriptionList className="grid gap-4 md:grid-cols-2 sm:col-start-1 sm:row-start-1">
                        <DescriptionListItem label={<Trans>Payment method</Trans>}>
                            {payment.method}
                        </DescriptionListItem>
                        <DescriptionListItem label={<Trans>Amount</Trans>}>
                            {formatCurrency(payment.amount, currencyCode)}
                        </DescriptionListItem>
                        <DescriptionListItem label={<Trans>Created at</Trans>}>
                            {formatDate(payment.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                        </DescriptionListItem>
                        {payment.transactionId && (
                            <DescriptionListItem label={<Trans>Transaction ID</Trans>}>
                                {payment.transactionId}
                            </DescriptionListItem>
                        )}
                        {/* We need to check if there is errorMessage field in the Payment type */}
                        {payment.errorMessage && (
                            <DescriptionItem>
                                <DescriptionTerm>
                                    <Trans>Error message</Trans>
                                </DescriptionTerm>
                                <DescriptionDetail className="text-destructive">
                                    {payment.errorMessage}
                                </DescriptionDetail>
                            </DescriptionItem>
                        )}
                    </DescriptionList>
                </div>
                <div className="mt-4">
                    <Dialog>
                        <DialogTrigger render={<Button variant="outline" size="sm" />}>
                            <Trans>View payment metadata</Trans>
                        </DialogTrigger>
                        <DialogContent size="xl" className="max-h-[85vh] overflow-hidden flex flex-col">
                            <DialogHeader>
                                <DialogTitle>
                                    <Trans>Payment metadata</Trans>
                                </DialogTitle>
                                <DialogDescription>
                                    <Trans>Metadata returned by the payment handler.</Trans>
                                </DialogDescription>
                            </DialogHeader>
                            <div className="overflow-auto flex-1">
                                <JsonViewer
                                    viewOnly
                                    rootFontSize={12}
                                    minWidth={100}
                                    rootName=""
                                    data={payment.metadata}
                                    collapse
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
                {payment.refunds && payment.refunds.length > 0 && (
                    <Collapsible className="mt-2 border-t pt-2">
                        <CollapsibleTrigger
                            className={cn(
                                'group flex w-full items-center justify-between rounded-md p-1 -m-1 text-sm text-muted-foreground hover:underline',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            )}
                        >
                            <Trans>Refunds ({payment.refunds.length})</Trans>
                            <ChevronDown className="h-4 w-4 transition-[rotate] duration-slow ease-height motion-reduce:transition-none group-data-[panel-open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 divide-y">
                            {payment.refunds.map(refund => (
                                <div key={refund.id} className="py-3 first:pt-1 last:pb-0">
                                    <DescriptionList orientation="horizontal">
                                        <DescriptionListItem label={<Trans>Refund ID</Trans>}>
                                            {refund.id}
                                        </DescriptionListItem>
                                        <DescriptionListItem label={<Trans>State</Trans>}>
                                            {getTranslatedRefundState(refund.state)}
                                        </DescriptionListItem>
                                        <DescriptionListItem label={<Trans>Created at</Trans>}>
                                            {formatDate(refund.createdAt, {
                                                dateStyle: 'short',
                                                timeStyle: 'short',
                                            })}
                                        </DescriptionListItem>
                                        <DescriptionListItem label={<Trans>Total</Trans>}>
                                            {formatCurrency(refund.total, currencyCode)}
                                        </DescriptionListItem>
                                        {refund.destination && (
                                            <DescriptionListItem label={<Trans>Destination</Trans>}>
                                                {refund.destination}
                                            </DescriptionListItem>
                                        )}
                                        {refund.reason && (
                                            <DescriptionListItem label={<Trans>Reason</Trans>}>
                                                {refund.reason}
                                            </DescriptionListItem>
                                        )}
                                        {refund.transactionId && (
                                            <DescriptionListItem label={<Trans>Transaction ID</Trans>}>
                                                {refund.transactionId}
                                            </DescriptionListItem>
                                        )}
                                        {refund.metadata && Object.keys(refund.metadata).length > 0 && (
                                            <DescriptionListItem label={<Trans>Metadata</Trans>}>
                                                <JsonViewer
                                                    viewOnly
                                                    rootFontSize={11}
                                                    minWidth={100}
                                                    rootName=""
                                                    data={refund.metadata}
                                                    collapse
                                                />
                                            </DescriptionListItem>
                                        )}
                                    </DescriptionList>
                                    {refund.state === 'Pending' && (
                                        <div className="mt-3">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleSettleRefund(refund.id)}
                                                disabled={settleRefundMutation.isPending}
                                            >
                                                <Trans>Settle refund</Trans>
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </CollapsibleContent>
                    </Collapsible>
                )}
            </div>
            <SettleRefundDialog
                open={settleRefundDialogOpen}
                onOpenChange={setSettleRefundDialogOpen}
                onSettle={handleSettleRefundConfirm}
                isLoading={settleRefundMutation.isPending}
            />
        </>
    );
}
