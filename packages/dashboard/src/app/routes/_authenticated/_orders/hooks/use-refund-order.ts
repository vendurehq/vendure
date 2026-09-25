import { getRefundDestinationExtension } from '@/vdb/framework/refund-destination/refund-destination-extensions.js';
import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

/**
 * A single row in the refund dialog: either one of the Order's Payments, or a refund destination
 * contributed by a plugin. Both draw their funds from a Payment, which is what limits how much
 * may be refunded.
 */
export interface RefundTarget {
    id: string;
    label: string;
    /** 'payment' = refund to the original payment method, 'destination' = a custom destination */
    type: 'payment' | 'destination';
    /** The Payment this target draws its refundable balance from. */
    paymentId: string;
    /** The Payments this target may draw from. A payment target may only ever use its own. */
    eligiblePaymentIds: string[];
    /** Set for destination targets only. */
    destinationCode?: string;
    amountToRefund: number;
    selected: boolean;
    /** Configuration collected by the destination's dashboard component, if it has one. */
    args?: Record<string, any>;
    icon?: React.ComponentType<{ className?: string }>;
    component?: React.ComponentType<any>;
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
    /** The refundable balance of each Payment, keyed by payment id. */
    paymentCapacity: Record<string, number>;
    /** The label and refundable balance of each Payment, for rendering the payment picker. */
    paymentOptions: Array<{ id: string; label: string; refundableAmount: number }>;
    validationErrors: string[];
    canSubmit: boolean;
    isCancelling: boolean;

    // Callbacks
    onRefundQuantityChange: (lineId: string, quantity: number) => void;
    onCancelChange: (lineId: string, cancel: boolean) => void;
    toggleShippingRefund: (lineId: string) => void;
    onTargetSelected: (targetId: string, selected: boolean) => void;
    onTargetAmountChange: (targetId: string, amount: number, selected?: boolean) => void;
    onTargetPaymentChange: (targetId: string, paymentId: string) => void;
    onTargetArgsChange: (targetId: string, args: Record<string, any> | undefined) => void;
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

    const refundablePayments = useMemo(() => getRefundablePayments(order.payments), [order.payments]);

    const paymentCapacity = useMemo(
        () =>
            Object.fromEntries(refundablePayments.map(p => [p.id, p.refundableAmount])) as Record<
                string,
                number
            >,
        [refundablePayments],
    );

    const paymentOptions = useMemo(
        () =>
            refundablePayments.map(p => ({
                id: p.id,
                label: p.method,
                refundableAmount: p.refundableAmount,
            })),
        [refundablePayments],
    );

    // Build the flat list of refund targets from payments + destinations
    const buildRefundTargets = useCallback((): RefundTarget[] => {
        const paymentTargets: RefundTarget[] = refundablePayments.map((p, index) => ({
            id: `payment-${p.id}`,
            label: p.method,
            type: 'payment',
            paymentId: p.id,
            eligiblePaymentIds: [p.id],
            amountToRefund: 0,
            selected: index === 0,
        }));

        // Destination targets. The default destination is represented by the payment rows, so it is
        // excluded here. A destination is only offered for the Payments the backend reports it as
        // available for.
        const destinations = destinationsQuery.data?.refundDestinations ?? [];
        const destinationTargets: RefundTarget[] = destinations
            .filter(d => d.code !== DEFAULT_REFUND_DESTINATION_CODE)
            .map(d => {
                const eligiblePaymentIds = d.availableForPaymentIds.filter(id => id in paymentCapacity);
                const extension = getRefundDestinationExtension(d.code);
                return {
                    id: `dest-${d.code}`,
                    label: extension?.label ?? d.description,
                    type: 'destination' as const,
                    paymentId: eligiblePaymentIds[0] ?? '',
                    eligiblePaymentIds,
                    destinationCode: d.code,
                    amountToRefund: 0,
                    selected: false,
                    icon: extension?.icon,
                    component: extension?.component,
                };
            })
            .filter(target => target.eligiblePaymentIds.length > 0);

        return [...paymentTargets, ...destinationTargets];
    }, [refundablePayments, paymentCapacity, destinationsQuery.data]);

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

    const totalRefundableAmount = useMemo(
        () => refundablePayments.reduce((sum, p) => sum + p.refundableAmount, 0),
        [refundablePayments],
    );

    const amountToRefundTotal = useMemo(
        () => refundTargets.reduce((sum, rt) => sum + rt.amountToRefund, 0),
        [refundTargets],
    );

    const recalculateRefundTotal = useCallback(() => {
        return calculateRefundTotal(order.lines, lineSelections, order.shippingLines, refundShippingLineIds);
    }, [order.lines, order.shippingLines, lineSelections, refundShippingLineIds]);

    const allocateToTargets = useCallback(
        (total: number) => {
            setRefundTargets(prev => {
                let remaining = total;
                // Track how much of each Payment's balance has been handed out, so that a payment
                // row and a destination drawing on the same Payment cannot together exceed it.
                const paymentRemaining = { ...paymentCapacity };
                // Payments are allocated before destinations so that, by default, a refund goes
                // back the way it came unless the administrator says otherwise.
                const selectedPayments = prev.filter(rt => rt.selected && rt.type === 'payment');
                const selectedDestinations = prev.filter(rt => rt.selected && rt.type === 'destination');
                const allocations = new Map<string, number>();
                for (const target of [...selectedPayments, ...selectedDestinations]) {
                    const available = paymentRemaining[target.paymentId] ?? 0;
                    const amount = Math.max(0, Math.min(available, remaining));
                    paymentRemaining[target.paymentId] = available - amount;
                    remaining -= amount;
                    allocations.set(target.id, amount);
                }
                return prev.map(target => ({
                    ...target,
                    amountToRefund: allocations.get(target.id) ?? 0,
                }));
            });
        },
        [paymentCapacity],
    );

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

                if (!selected) {
                    return updated.map(rt => (rt.id === targetId ? { ...rt, amountToRefund: 0 } : rt));
                }
                const target = updated.find(rt => rt.id === targetId);
                if (!target) {
                    return updated;
                }
                const otherAllocated = updated
                    .filter(rt => rt.id !== targetId && rt.selected)
                    .reduce((sum, rt) => sum + rt.amountToRefund, 0);
                const allocatedToSamePayment = updated
                    .filter(rt => rt.id !== targetId && rt.selected && rt.paymentId === target.paymentId)
                    .reduce((sum, rt) => sum + rt.amountToRefund, 0);
                const paymentRemaining =
                    (paymentCapacity[target.paymentId] ?? 0) - allocatedToSamePayment;
                const outstanding = refundTotal - otherAllocated;
                const amountToRefund = Math.max(0, Math.min(outstanding, paymentRemaining));
                return updated.map(rt => (rt.id === targetId ? { ...rt, amountToRefund } : rt));
            });
        },
        [refundTotal, paymentCapacity],
    );

    const onTargetAmountChange = useCallback((targetId: string, amount: number, selected?: boolean) => {
        setRefundTargets(prev =>
            prev.map(rt => {
                if (rt.id !== targetId) return rt;
                return { ...rt, amountToRefund: amount, ...(selected !== undefined ? { selected } : {}) };
            }),
        );
    }, []);

    const onTargetPaymentChange = useCallback((targetId: string, paymentId: string) => {
        setRefundTargets(prev => prev.map(rt => (rt.id === targetId ? { ...rt, paymentId } : rt)));
    }, []);

    const onTargetArgsChange = useCallback((targetId: string, args: Record<string, any> | undefined) => {
        setRefundTargets(prev => prev.map(rt => (rt.id === targetId ? { ...rt, args } : rt)));
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

        if (refundTotal > totalRefundableAmount) {
            errors.push(
                t`Refund total exceeds maximum refundable amount of ${formatCurrency(totalRefundableAmount, order.currencyCode)}`,
            );
        }

        // Every target draws on a Payment, so the amounts allocated against each Payment must fit
        // within that Payment's refundable balance, however they are split between the original
        // payment method and any destinations.
        const allocatedPerPayment = new Map<string, number>();
        for (const target of refundTargets) {
            if (!target.selected || target.amountToRefund <= 0) continue;
            allocatedPerPayment.set(
                target.paymentId,
                (allocatedPerPayment.get(target.paymentId) ?? 0) + target.amountToRefund,
            );
        }
        for (const [paymentId, allocated] of allocatedPerPayment) {
            const capacity = paymentCapacity[paymentId] ?? 0;
            if (allocated > capacity) {
                const label = paymentOptions.find(p => p.id === paymentId)?.label ?? paymentId;
                errors.push(
                    t`Amounts drawn from payment ${label} exceed its refundable amount of ${formatCurrency(capacity, order.currencyCode)}`,
                );
            }
        }

        if (refundTargets.some(rt => rt.selected && rt.amountToRefund > 0 && !rt.paymentId)) {
            errors.push(t`Every refund destination must draw from a payment`);
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
        totalRefundableAmount,
        amountToRefundTotal,
        refundTargets,
        paymentCapacity,
        paymentOptions,
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

            const selectedTargets = refundTargets.filter(rt => rt.selected && rt.amountToRefund > 0);
            if (selectedTargets.length === 0) {
                toast.error(t`Failed to process refund`, {
                    description: t`No payment or destination was selected`,
                });
                setIsSubmitting(false);
                return;
            }

            // A single mutation carries every target, so the server validates all of them before
            // any funds move.
            const refundResult = await refundOrderMutation.mutateAsync({
                input: {
                    lines: refundLines,
                    reason,
                    paymentId: selectedTargets[0].paymentId,
                    shipping: 0,
                    adjustment: 0,
                    targets: selectedTargets.map(target => ({
                        paymentId: target.paymentId,
                        amount: target.amountToRefund,
                        destination: target.destinationCode,
                        arguments: target.args,
                    })),
                },
            });

            if (refundResult.refundOrder.__typename === 'RefundIncompleteError') {
                // Some targets were refunded before one failed, and those Refunds are kept on the
                // server. The dialog is closed and the Order reloaded instead of keeping the stale
                // allocation, which would refund the earlier targets again if it were resubmitted.
                const { refunds, failedTargetIndex, failureReason } = refundResult.refundOrder;
                const refundedAmount = formatCurrency(
                    refunds.reduce((sum, r) => sum + r.total, 0),
                    order.currencyCode,
                );
                const refundCount = refunds.length;
                const failedTargetLabel = selectedTargets[failedTargetIndex]?.label ?? String(failedTargetIndex);
                toast.warning(t`Refund only partially completed`, {
                    description: t`${refundedAmount} was refunded in ${refundCount} refund(s), but "${failedTargetLabel}" failed: ${failureReason}. Check the order's payments before trying again.`,
                    duration: Infinity,
                });
                onSuccess?.();
                return;
            }

            if (refundResult.refundOrder.__typename !== 'Refund') {
                toast.error(t`Failed to process refund`, {
                    description: refundResult.refundOrder.message,
                });
                setIsSubmitting(false);
                return;
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
        paymentCapacity,
        paymentOptions,
        validationErrors,
        canSubmit,
        isCancelling,

        // Callbacks
        onRefundQuantityChange,
        onCancelChange,
        toggleShippingRefund,
        onTargetSelected,
        onTargetAmountChange,
        onTargetPaymentChange,
        onTargetArgsChange,
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
