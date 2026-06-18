import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { cancelOrderDocument, refundOrderDocument } from '../orders.graphql.js';
import { Order } from '../utils/order-types.js';
import {
    allocateRefundsToPayments,
    calculateRefundTotal,
    getOrderLineInputFromSelections,
    getRefundablePayments,
    getTotalAmountToRefund,
    getTotalRefundableAmount,
    LineSelection,
    RefundablePayment,
} from '../utils/refund-utils.js';

export interface UseRefundOrderReturn {
    // State
    lineSelections: Record<string, LineSelection>;
    refundShippingLineIds: string[];
    selectedReason: string;
    customReason: string;
    manuallySetRefundTotal: boolean;
    refundTotal: number;
    refundablePayments: RefundablePayment[];
    isSubmitting: boolean;

    // Derived (useMemo)
    reason: string;
    totalRefundableAmount: number;
    amountToRefundTotal: number;
    validationErrors: string[];
    canSubmit: boolean;
    isCancelling: boolean;

    // Callbacks
    onRefundQuantityChange: (lineId: string, quantity: number) => void;
    onCancelChange: (lineId: string, cancel: boolean) => void;
    toggleShippingRefund: (lineId: string) => void;
    onPaymentSelected: (paymentId: string, selected: boolean) => void;
    onPaymentAmountChange: (paymentId: string, amount: number) => void;
    onManualRefundTotalChange: (value: number) => void;
    setSelectedReason: (reason: string) => void;
    setCustomReason: (reason: string) => void;
    setManuallySetRefundTotal: (value: boolean) => void;
    recalculateRefundTotal: () => number;

    // Actions
    handleSubmit: () => Promise<void>;
    resetState: () => void;
}

export function useRefundOrder(order: Order, onSuccess?: () => void): UseRefundOrderReturn {
    const { t } = useLingui();
    const { formatCurrency } = useLocalFormat();

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [lineSelections, setLineSelections] = useState<Record<string, LineSelection>>({});
    const [refundShippingLineIds, setRefundShippingLineIds] = useState<string[]>([]);
    const [selectedReason, setSelectedReason] = useState<string>('');
    const [customReason, setCustomReason] = useState('');
    const [manuallySetRefundTotal, setManuallySetRefundTotal] = useState(false);
    const [refundTotal, setRefundTotal] = useState(0);
    const [refundablePayments, setRefundablePayments] = useState<RefundablePayment[]>([]);

    const reason = selectedReason === 'other' ? customReason : selectedReason;

    const cancelOrderMutation = useMutation({
        mutationFn: api.mutate(cancelOrderDocument),
    });

    const refundOrderMutation = useMutation({
        mutationFn: api.mutate(refundOrderDocument),
    });

    const resetState = useCallback(() => {
        const selections: Record<string, LineSelection> = {};
        order.lines.forEach(line => {
            selections[line.id] = { quantity: 0, cancel: false };
        });
        setLineSelections(selections);
        setRefundShippingLineIds([]);
        setSelectedReason('');
        setCustomReason('');
        setManuallySetRefundTotal(false);
        setRefundTotal(0);
        setRefundablePayments(getRefundablePayments(order.payments));
    }, [order]);

    const totalRefundableAmount = useMemo(
        () => getTotalRefundableAmount(refundablePayments),
        [refundablePayments],
    );

    const amountToRefundTotal = useMemo(
        () => getTotalAmountToRefund(refundablePayments),
        [refundablePayments],
    );

    const recalculateRefundTotal = useCallback(() => {
        return calculateRefundTotal(order.lines, lineSelections, order.shippingLines, refundShippingLineIds);
    }, [order.lines, order.shippingLines, lineSelections, refundShippingLineIds]);

    const updateRefundTotal = useCallback(() => {
        if (manuallySetRefundTotal) {
            setRefundablePayments(prev => allocateRefundsToPayments(prev, refundTotal));
        } else {
            const calculatedTotal = recalculateRefundTotal();
            setRefundTotal(calculatedTotal);
            setRefundablePayments(prev => allocateRefundsToPayments(prev, calculatedTotal));
        }
    }, [manuallySetRefundTotal, recalculateRefundTotal, refundTotal]);

    useEffect(() => {
        updateRefundTotal();
    }, [updateRefundTotal]);

    const onRefundQuantityChange = useCallback((lineId: string, quantity: number) => {
        setManuallySetRefundTotal(false);
        setLineSelections(prev => {
            const prevLine = prev[lineId];
            if (!prevLine) return prev;

            const previousQuantity = prevLine.quantity;
            let cancel = prevLine.cancel;

            if (quantity === 0) {
                cancel = false;
            } else if (previousQuantity === 0 && quantity > 0) {
                cancel = true;
            }

            return {
                ...prev,
                [lineId]: { quantity, cancel },
            };
        });
    }, []);

    const onCancelChange = useCallback((lineId: string, cancel: boolean) => {
        setLineSelections(prev => ({
            ...prev,
            [lineId]: { ...prev[lineId], cancel },
        }));
    }, []);

    const toggleShippingRefund = useCallback((lineId: string) => {
        setManuallySetRefundTotal(false);
        setRefundShippingLineIds(prev => {
            if (prev.includes(lineId)) {
                return prev.filter(id => id !== lineId);
            }
            return [...prev, lineId];
        });
    }, []);

    const onPaymentSelected = useCallback(
        (paymentId: string, selected: boolean) => {
            setRefundablePayments(prev => {
                const updatedPayments = prev.map(p => (p.id === paymentId ? { ...p, selected } : p));

                if (selected) {
                    const otherAllocated = updatedPayments
                        .filter(p => p.id !== paymentId && p.selected)
                        .reduce((sum, p) => sum + p.amountToRefund, 0);
                    const outstanding = refundTotal - otherAllocated;
                    return updatedPayments.map(p => {
                        if (p.id === paymentId && outstanding > 0) {
                            return { ...p, amountToRefund: Math.min(outstanding, p.refundableAmount) };
                        }
                        return p;
                    });
                } else {
                    return updatedPayments.map(p => (p.id === paymentId ? { ...p, amountToRefund: 0 } : p));
                }
            });
        },
        [refundTotal],
    );

    const onPaymentAmountChange = useCallback((paymentId: string, amount: number) => {
        setRefundablePayments(prev =>
            prev.map(p => (p.id === paymentId ? { ...p, amountToRefund: amount } : p)),
        );
    }, []);

    const onManualRefundTotalChange = useCallback((value: number) => {
        setRefundTotal(value);
        setRefundablePayments(prev => allocateRefundsToPayments(prev, value));
    }, []);

    const validationErrors = useMemo(() => {
        const errors: string[] = [];

        if (refundTotal < 0) {
            errors.push(t`Refund total cannot be negative`);
        }

        if (refundTotal > totalRefundableAmount) {
            errors.push(
                t`Refund total exceeds maximum refundable amount of ${formatCurrency(totalRefundableAmount, order.currencyCode)}`,
            );
        }

        if (amountToRefundTotal !== refundTotal && refundTotal > 0) {
            errors.push(t`Allocated payment amount must equal refund total`);
        }

        if (refundTotal > 0 && !reason) {
            errors.push(t`A reason for the refund is required`);
        }

        return errors;
    }, [
        refundTotal,
        totalRefundableAmount,
        amountToRefundTotal,
        reason,
        formatCurrency,
        order.currencyCode,
        t,
    ]);

    const canSubmit = useMemo(() => {
        return (
            refundTotal > 0 &&
            amountToRefundTotal === refundTotal &&
            !!reason &&
            validationErrors.length === 0
        );
    }, [refundTotal, amountToRefundTotal, reason, validationErrors]);

    const isCancelling = useMemo(() => {
        return Object.values(lineSelections).some(line => line.quantity > 0 && line.cancel);
    }, [lineSelections]);

    const handleSubmit = async () => {
        setIsSubmitting(true);

        try {
            const refundLines = getOrderLineInputFromSelections(lineSelections);
            const cancelLines = getOrderLineInputFromSelections(lineSelections, line => line.cancel);

            if (isCancelling && cancelLines.length > 0) {
                const cancelResult = await cancelOrderMutation.mutateAsync({
                    input: {
                        orderId: order.id,
                        lines: cancelLines,
                        reason,
                        cancelShipping: refundShippingLineIds.length > 0,
                    },
                });

                if (cancelResult.cancelOrder.__typename !== 'Order') {
                    toast.error(t`Failed to cancel order items`, {
                        description: cancelResult.cancelOrder.message,
                    });
                    setIsSubmitting(false);
                    return;
                }
            }

            const paymentsToRefund = refundablePayments.filter(p => p.selected && p.amountToRefund > 0);

            let successfulRefundCount = 0;

            for (const payment of paymentsToRefund) {
                const refundResult = await refundOrderMutation.mutateAsync({
                    input: {
                        lines: refundLines,
                        reason,
                        paymentId: payment.id,
                        amount: payment.amountToRefund,
                        shipping: 0,
                        adjustment: 0,
                    },
                });

                if (refundResult.refundOrder.__typename !== 'Refund') {
                    if (successfulRefundCount > 0) {
                        toast.warning(t`Partial refund completed`, {
                            description: t`${successfulRefundCount} payment(s) refunded before failure. Check order history for details.`,
                        });
                    }
                    toast.error(t`Failed to process refund`, {
                        description: refundResult.refundOrder.message,
                    });
                    setIsSubmitting(false);
                    return;
                }

                successfulRefundCount++;
            }

            toast.success(t`Refund processed successfully`);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to process refund`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        // State
        lineSelections,
        refundShippingLineIds,
        selectedReason,
        customReason,
        manuallySetRefundTotal,
        refundTotal,
        refundablePayments,
        isSubmitting,

        // Derived
        reason,
        totalRefundableAmount,
        amountToRefundTotal,
        validationErrors,
        canSubmit,
        isCancelling,

        // Callbacks
        onRefundQuantityChange,
        onCancelChange,
        toggleShippingRefund,
        onPaymentSelected,
        onPaymentAmountChange,
        onManualRefundTotalChange,
        setSelectedReason,
        setCustomReason,
        setManuallySetRefundTotal,
        recalculateRefundTotal,

        // Actions
        handleSubmit,
        resetState,
    };
}
