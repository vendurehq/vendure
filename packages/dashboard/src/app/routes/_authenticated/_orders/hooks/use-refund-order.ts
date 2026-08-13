import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

// Must match DEFAULT_REFUND_DESTINATION_CODE from @vendure/common/lib/shared-constants.
// Can't import the value directly because @vendure/common is CJS and Vite
// can't extract named exports from CJS modules at runtime.
const DEFAULT_REFUND_DESTINATION_CODE = 'default';

import { cancelOrderDocument, refundDestinationsDocument, refundOrderDocument } from '../orders.graphql.js';
import { Order } from '../utils/order-types.js';
import {
    calculateRefundTotal,
    getOrderLineInputFromSelections,
    getRefundablePayments,
    LineSelection,
} from '../utils/refund-utils.js';

export interface RefundTarget {
    id: string;
    label: string;
    description: string;
    /** The max refundable amount (only applies to payment targets) */
    maxAmount: number;
    amountToRefund: number;
    selected: boolean;
    /** 'payment' = original payment, 'destination' = custom destination */
    type: 'payment' | 'destination';
    /** For payments: the payment ID. For destinations: the first available payment ID. */
    paymentId: string;
    /** For destinations: the destination code */
    destinationCode?: string;
}

export interface UseRefundOrderReturn {
    // State
    lineSelections: Record<string, LineSelection>;
    refundShippingLineIds: string[];
    selectedReason: string;
    customReason: string;
    manuallySetRefundTotal: boolean;
    refundTotal: number;
    refundTargets: RefundTarget[];
    isSubmitting: boolean;

    // Derived
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
    onTargetSelected: (targetId: string, selected: boolean) => void;
    onTargetAmountChange: (targetId: string, amount: number) => void;
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
    const [refundTargets, setRefundTargets] = useState<RefundTarget[]>([]);

    const destinationsQuery = useQuery({
        queryKey: ['refundDestinations', order.id],
        queryFn: () => api.query(refundDestinationsDocument, { orderId: order.id }),
    });

    const reason = selectedReason === 'other' ? customReason : selectedReason;

    const cancelOrderMutation = useMutation({
        mutationFn: api.mutate(cancelOrderDocument),
    });

    const refundOrderMutation = useMutation({
        mutationFn: api.mutate(refundOrderDocument),
    });

    // Build the flat list of refund targets from payments + destinations
    const buildRefundTargets = useCallback((): RefundTarget[] => {
        const payments = getRefundablePayments(order.payments);
        const firstRefundablePaymentId =
            (payments.find(p => p.refundableAmount > 0) ?? payments[0])?.id ?? '';

        // Payment targets
        const paymentTargets: RefundTarget[] = payments.map((p, index) => ({
            id: `payment-${p.id}`,
            label: p.method,
            description: formatCurrency(p.refundableAmount, order.currencyCode),
            maxAmount: p.refundableAmount,
            amountToRefund: 0,
            selected: index === 0,
            type: 'payment',
            paymentId: p.id,
        }));

        // Destination targets (exclude the default one — that's represented by the payments themselves)
        const destinations = destinationsQuery.data?.refundDestinations ?? [];
        const destinationTargets: RefundTarget[] = destinations
            .filter(d => d.code !== DEFAULT_REFUND_DESTINATION_CODE)
            .map(d => ({
                id: `dest-${d.code}`,
                label: d.description,
                description: '',
                maxAmount: Infinity,
                amountToRefund: 0,
                selected: false,
                type: 'destination' as const,
                paymentId: firstRefundablePaymentId,
                destinationCode: d.code,
            }));

        return [...paymentTargets, ...destinationTargets];
    }, [order.payments, order.currencyCode, destinationsQuery.data, formatCurrency]);

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
        setRefundTargets(buildRefundTargets());
    }, [order, buildRefundTargets]);

    // Rebuild targets when destinations load or payments change
    useEffect(() => {
        setRefundTargets(buildRefundTargets());
    }, [buildRefundTargets]);

    const totalRefundableAmount = useMemo(() => {
        // Only payments have a finite max
        const payments = getRefundablePayments(order.payments);
        return payments.reduce((sum, p) => sum + p.refundableAmount, 0);
    }, [order.payments]);

    const amountToRefundTotal = useMemo(
        () => refundTargets.reduce((sum, rt) => sum + rt.amountToRefund, 0),
        [refundTargets],
    );

    const recalculateRefundTotal = useCallback(() => {
        return calculateRefundTotal(order.lines, lineSelections, order.shippingLines, refundShippingLineIds);
    }, [order.lines, order.shippingLines, lineSelections, refundShippingLineIds]);

    const allocateToTargets = useCallback((total: number) => {
        setRefundTargets(prev => {
            let remaining = total;
            // Allocate to payment targets first, then destinations,
            // to prevent infinite-max destinations from consuming everything.
            const selectedPayments = prev.filter(target => target.selected && target.type === 'payment');
            const selectedDestinations = prev.filter(
                target => target.selected && target.type === 'destination',
            );
            const allocations = new Map<string, number>();
            for (const target of [...selectedPayments, ...selectedDestinations]) {
                const amount = Math.min(
                    target.maxAmount === Infinity ? remaining : target.maxAmount,
                    remaining,
                );
                remaining -= amount;
                allocations.set(target.id, amount);
            }
            return prev.map(target => ({
                ...target,
                amountToRefund: allocations.get(target.id) ?? 0,
            }));
        });
    }, []);

    const updateRefundTotal = useCallback(() => {
        if (!manuallySetRefundTotal) {
            const calculatedTotal = recalculateRefundTotal();
            setRefundTotal(calculatedTotal);
            allocateToTargets(calculatedTotal);
        }
    }, [manuallySetRefundTotal, recalculateRefundTotal, allocateToTargets]);

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

    const onTargetSelected = useCallback(
        (targetId: string, selected: boolean) => {
            setRefundTargets(prev => {
                const updated = prev.map(rt => (rt.id === targetId ? { ...rt, selected } : rt));

                if (selected) {
                    const otherAllocated = updated
                        .filter(rt => rt.id !== targetId && rt.selected)
                        .reduce((sum, rt) => sum + rt.amountToRefund, 0);
                    const outstanding = refundTotal - otherAllocated;
                    return updated.map(rt => {
                        if (rt.id === targetId && outstanding > 0) {
                            return {
                                ...rt,
                                amountToRefund: Math.min(
                                    outstanding,
                                    rt.maxAmount === Infinity ? outstanding : rt.maxAmount,
                                ),
                            };
                        }
                        return rt;
                    });
                } else {
                    return updated.map(rt => (rt.id === targetId ? { ...rt, amountToRefund: 0 } : rt));
                }
            });
        },
        [refundTotal],
    );

    const onTargetAmountChange = useCallback((targetId: string, amount: number, selected?: boolean) => {
        setRefundTargets(prev =>
            prev.map(rt => {
                if (rt.id !== targetId) return rt;
                return { ...rt, amountToRefund: amount, ...(selected !== undefined ? { selected } : {}) };
            }),
        );
    }, []);

    const onManualRefundTotalChange = useCallback(
        (value: number) => {
            setRefundTotal(value);
            allocateToTargets(value);
        },
        [allocateToTargets],
    );

    const validationErrors = useMemo(() => {
        const errors: string[] = [];

        if (refundTotal < 0) {
            errors.push(t`Refund total cannot be negative`);
        }

        if (!manuallySetRefundTotal && refundTotal > totalRefundableAmount) {
            errors.push(
                t`Refund total exceeds maximum refundable amount of ${formatCurrency(totalRefundableAmount, order.currencyCode)}`,
            );
        }

        if (amountToRefundTotal !== refundTotal && refundTotal > 0) {
            errors.push(t`Allocated refund amounts must equal refund total`);
        }

        if (refundTotal > 0 && !reason) {
            errors.push(t`A reason for the refund is required`);
        }

        return errors;
    }, [
        refundTotal,
        manuallySetRefundTotal,
        totalRefundableAmount,
        amountToRefundTotal,
        reason,
        formatCurrency,
        order.currencyCode,
        t,
    ]);

    const canSubmit = useMemo(() => {
        if (refundTotal <= 0 || !reason || validationErrors.length > 0) {
            return false;
        }
        return amountToRefundTotal === refundTotal;
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

            let successfulRefundCount = 0;

            const selectedTargets = refundTargets.filter(rt => rt.selected && rt.amountToRefund > 0);

            for (let i = 0; i < selectedTargets.length; i++) {
                const target = selectedTargets[i];
                // Only attach refund lines to the first target to avoid
                // duplicate RefundLine records for the same order lines.
                const lines = i === 0 ? refundLines : [];
                const refundResult = await refundOrderMutation.mutateAsync({
                    input: {
                        lines,
                        reason,
                        paymentId: target.paymentId,
                        amount: target.amountToRefund,
                        shipping: 0,
                        adjustment: 0,
                        destination: target.destinationCode,
                    },
                });

                if (refundResult.refundOrder.__typename !== 'Refund') {
                    if (successfulRefundCount > 0) {
                        toast.warning(t`Partial refund completed`, {
                            description: t`${successfulRefundCount} refund(s) processed before failure. Check order history for details.`,
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
        refundTargets,
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
        onTargetSelected,
        onTargetAmountChange,
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
