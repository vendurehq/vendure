import { LabeledData } from '@/vdb/components/labeled-data.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/vdb/components/ui/collapsible.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
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
import {
    getTypeForState,
    StateTransitionAction,
    StateTransitionControl,
} from './state-transition-control.js';

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
                type: 'success',
                disabled: settlePaymentMutation.isPending,
            });
        }

        nextOtherStates().forEach(state => {
            actions.push({
                label:
                    state === 'Cancelled'
                        ? t`Cancel payment`
                        : t`Transition to ${getTranslatedPaymentState(state)}`,
                type: getTypeForState(state),
                onClick: () => handlePaymentStateTransition(state),
                disabled: transitionPaymentMutation.isPending || cancelPaymentMutation.isPending,
            });
        });

        return actions;
    };

    return (
        <>
            <div className="space-y-1 p-3 border rounded-md">
                <div className="grid lg:grid-cols-2 gap-2">
                    <LabeledData label={<Trans>Payment method</Trans>} value={payment.method} />
                    <LabeledData
                        label={<Trans>Amount</Trans>}
                        value={formatCurrency(payment.amount, currencyCode)}
                    />
                    <LabeledData
                        label={<Trans>Created at</Trans>}
                        value={formatDate(payment.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                    />
                    {payment.transactionId && (
                        <LabeledData label={<Trans>Transaction ID</Trans>} value={payment.transactionId} />
                    )}
                    {/* We need to check if there is errorMessage field in the Payment type */}
                    {payment.errorMessage && (
                        <LabeledData
                            label={<Trans>Error message</Trans>}
                            value={payment.errorMessage}
                            className="text-destructive"
                        />
                    )}
                </div>
                <Collapsible className="mt-2 border-t pt-2">
                    <CollapsibleTrigger className="flex items-center justify-between w-full text-sm hover:underline text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md p-1 -m-1">
                        <Trans>Payment metadata</Trans>
                        <ChevronDown className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2">
                        <JsonViewer
                            viewOnly
                            rootFontSize={12}
                            minWidth={100}
                            rootName=""
                            data={payment.metadata}
                            collapse
                        />
                    </CollapsibleContent>
                </Collapsible>
                {payment.refunds && payment.refunds.length > 0 && (
                    <Collapsible className="mt-2 border-t pt-2">
                        <CollapsibleTrigger className="flex items-center justify-between w-full text-sm hover:underline text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md p-1 -m-1">
                            <Trans>Refunds ({payment.refunds.length})</Trans>
                            <ChevronDown className="h-4 w-4 transition-transform duration-200 data-[state=open]:rotate-180" />
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-2 space-y-3">
                            {payment.refunds.map(refund => (
                                <div key={refund.id} className="p-3 border rounded-md bg-muted/50">
                                    <div className="space-y-1">
                                        <LabeledData label={<Trans>Refund ID</Trans>} value={refund.id} />
                                        <LabeledData
                                            label={<Trans>State</Trans>}
                                            value={getTranslatedRefundState(refund.state)}
                                        />
                                        <LabeledData
                                            label={<Trans>Created at</Trans>}
                                            value={formatDate(refund.createdAt, {
                                                dateStyle: 'short',
                                                timeStyle: 'short',
                                            })}
                                        />
                                        <LabeledData
                                            label={<Trans>Total</Trans>}
                                            value={formatCurrency(refund.total, currencyCode)}
                                        />
                                        {refund.reason && (
                                            <LabeledData
                                                label={<Trans>Reason</Trans>}
                                                value={refund.reason}
                                            />
                                        )}
                                        {refund.transactionId && (
                                            <LabeledData
                                                label={<Trans>Transaction ID</Trans>}
                                                value={refund.transactionId}
                                            />
                                        )}
                                        {refund.metadata && Object.keys(refund.metadata).length > 0 && (
                                            <div className="mt-2">
                                                <LabeledData label={<Trans>Metadata</Trans>} value="" />
                                                <JsonViewer
                                                    viewOnly
                                                    rootFontSize={11}
                                                    minWidth={100}
                                                    rootName=""
                                                    data={refund.metadata}
                                                    collapse
                                                />
                                            </div>
                                        )}
                                    </div>
                                    {refund.state === 'Pending' && (
                                        <div className="mt-3 pt-3 border-t">
                                            <Button
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
                <div className="mt-3 pt-3 border-t">
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
