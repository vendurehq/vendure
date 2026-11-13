import type { ComponentType } from 'react';

import { Order, Payment } from './order-types.js';

export type RefundablePayment = Payment & {
    refundableAmount: number;
};

export type LineSelection = { quantity: number; cancel: boolean };

/**
 * Filters payments to only those that are settled and calculates the refundable amount
 * (payment amount minus sum of non-failed refunds).
 */
export function getRefundablePayments(payments: Payment[] | undefined | null): RefundablePayment[] {
    const settledPayments = (payments ?? []).filter(p => p.state === 'Settled');
    return settledPayments.map(payment => {
        const successfulRefunds = payment.refunds.filter(r => r.state !== 'Failed');
        const refundedTotal = successfulRefunds.reduce((sum, refund) => sum + (refund.total || 0), 0);
        const refundableAmount = Math.max(0, payment.amount - refundedTotal);
        return {
            ...payment,
            refundableAmount,
        };
    });
}

/**
 * Calculate total refund amount from line selections and shipping
 */
export function calculateRefundTotal(
    lines: Order['lines'],
    lineSelections: Record<string, LineSelection>,
    shippingLines: Order['shippingLines'],
    refundShippingLineIds: string[],
): number {
    const itemTotal = lines.reduce((total, line) => {
        const selection = lineSelections[line.id];
        const refundCount = selection?.quantity || 0;
        return total + line.proratedUnitPriceWithTax * refundCount;
    }, 0);

    const shippingTotal = shippingLines.reduce((total, line) => {
        if (refundShippingLineIds.includes(line.id)) {
            return total + line.discountedPriceWithTax;
        }
        return total;
    }, 0);

    return itemTotal + shippingTotal;
}

/**
 * Convert line selections to GraphQL input format
 */
export function getOrderLineInputFromSelections(
    lineSelections: Record<string, LineSelection>,
    filterFn: (line: LineSelection) => boolean = () => true,
): Array<{ orderLineId: string; quantity: number }> {
    return Object.entries(lineSelections)
        .filter(([, line]) => line.quantity > 0 && filterFn(line))
        .map(([orderLineId, line]) => ({ orderLineId, quantity: line.quantity }));
}

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
    icon?: ComponentType<{ className?: string }>;
    component?: ComponentType<any>;
}

/**
 * Merges a rebuilt list of refund targets into the current list. A target in both lists keeps
 * `selected`, `amountToRefund` and `args` from the current list. It keeps `paymentId` too, if that
 * payment is still in the rebuilt `eligiblePaymentIds`. Its `label`, `type`, `eligiblePaymentIds`,
 * `destinationCode`, `icon` and `component` come from the rebuilt list. A target which appears only in
 * the rebuilt list starts unselected with a zero amount, so it does not change the allocation the
 * administrator has made. A target which appears only in the current list is dropped.
 *
 * When no rebuilt target appears in the current list, the function returns the rebuilt list with its
 * default selection. Otherwise every target would be unselected.
 */
export function mergeRefundTargets(current: RefundTarget[], rebuilt: RefundTarget[]): RefundTarget[] {
    const currentById = new Map(current.map(target => [target.id, target]));
    if (!rebuilt.some(target => currentById.has(target.id))) {
        return rebuilt;
    }
    return rebuilt.map(target => {
        const existing = currentById.get(target.id);
        if (!existing) {
            return { ...target, selected: false, amountToRefund: 0 };
        }
        return {
            ...target,
            selected: existing.selected,
            amountToRefund: existing.amountToRefund,
            args: existing.args,
            paymentId: target.eligiblePaymentIds.includes(existing.paymentId)
                ? existing.paymentId
                : target.paymentId,
        };
    });
}

/**
 * Allocates the refund total across the selected targets. Payment targets are allocated before
 * destination targets, so by default a refund goes back to the payment it came from. Each allocation
 * is capped at the refundable balance left on its payment, so a payment target and a destination
 * target which draw on the same payment cannot together exceed that balance.
 */
export function allocateRefundTotal(
    targets: RefundTarget[],
    total: number,
    paymentCapacity: Record<string, number>,
): RefundTarget[] {
    let remaining = total;
    const paymentRemaining = { ...paymentCapacity };
    const selectedPayments = targets.filter(rt => rt.selected && rt.type === 'payment');
    const selectedDestinations = targets.filter(rt => rt.selected && rt.type === 'destination');
    const allocations = new Map<string, number>();
    for (const target of [...selectedPayments, ...selectedDestinations]) {
        const available = paymentRemaining[target.paymentId] ?? 0;
        const amount = Math.max(0, Math.min(available, remaining));
        paymentRemaining[target.paymentId] = available - amount;
        remaining -= amount;
        allocations.set(target.id, amount);
    }
    return targets.map(target => ({
        ...target,
        amountToRefund: allocations.get(target.id) ?? 0,
    }));
}

/**
 * Merges a rebuilt list of refund targets into the current list with `mergeRefundTargets`. If the
 * merge leaves the allocation invalid, the function allocates the refund total again. The merge leaves
 * the allocation invalid in three cases:
 *
 * - No rebuilt target appears in the current list, so the merge returns the defaults with every
 *   amount at zero.
 * - A selected target with a non-zero amount is missing from the rebuilt list, so its amount is lost.
 *   If no remaining target is selected, the function uses the rebuilt list's default selection, so
 *   the total has a target to go to.
 * - The amounts drawn from a payment exceed its refundable balance, which an order refetch can lower.
 *
 * In every other case the amounts the administrator has entered are kept.
 */
export function reconcileRefundTargets(
    current: RefundTarget[],
    rebuilt: RefundTarget[],
    refundTotal: number,
    paymentCapacity: Record<string, number>,
): RefundTarget[] {
    const merged = mergeRefundTargets(current, rebuilt);
    // `mergeRefundTargets` returns the rebuilt list itself when it falls back to the defaults.
    const fellBackToDefaults = merged === rebuilt;
    const rebuiltIds = new Set(rebuilt.map(target => target.id));
    const droppedAllocation = current.some(
        target => target.selected && target.amountToRefund > 0 && !rebuiltIds.has(target.id),
    );
    if (droppedAllocation && !merged.some(target => target.selected)) {
        return allocateRefundTotal(rebuilt, refundTotal, paymentCapacity);
    }
    if (fellBackToDefaults || droppedAllocation || isAnyPaymentOverdrawn(merged, paymentCapacity)) {
        return allocateRefundTotal(merged, refundTotal, paymentCapacity);
    }
    return merged;
}

function isAnyPaymentOverdrawn(targets: RefundTarget[], paymentCapacity: Record<string, number>): boolean {
    const drawn = new Map<string, number>();
    for (const target of targets) {
        if (target.selected && target.amountToRefund > 0) {
            drawn.set(target.paymentId, (drawn.get(target.paymentId) ?? 0) + target.amountToRefund);
        }
    }
    return [...drawn].some(([paymentId, amount]) => amount > (paymentCapacity[paymentId] ?? 0));
}
