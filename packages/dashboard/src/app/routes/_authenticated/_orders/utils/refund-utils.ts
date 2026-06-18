import { Order, Payment } from './order-types.js';

// === Types ===

export type RefundablePayment = Payment & {
    refundableAmount: number;
    amountToRefund: number;
    selected: boolean;
};

export type LineSelection = { quantity: number; cancel: boolean };

// === Refundable Payment Functions ===

/**
 * Filters payments to only those that are settled and calculates the refundable amount
 * (payment amount minus sum of non-failed refunds).
 */
export function getRefundablePayments(payments: Payment[] | undefined | null): RefundablePayment[] {
    const settledPayments = (payments ?? []).filter(p => p.state === 'Settled');
    return settledPayments.map((payment, index) => {
        const successfulRefunds = payment.refunds.filter(r => r.state !== 'Failed');
        const refundedTotal = successfulRefunds.reduce((sum, refund) => sum + (refund.total || 0), 0);
        const refundableAmount = Math.max(0, payment.amount - refundedTotal);
        return {
            ...payment,
            refundableAmount,
            amountToRefund: 0,
            selected: index === 0,
        };
    });
}

/**
 * Calculates the total refundable amount across all payments.
 */
export function getTotalRefundableAmount(refundablePayments: RefundablePayment[]): number {
    return refundablePayments.reduce((sum, p) => sum + p.refundableAmount, 0);
}

/**
 * Calculates the total amount currently allocated to refund across all payments.
 */
export function getTotalAmountToRefund(refundablePayments: RefundablePayment[]): number {
    return refundablePayments.reduce((sum, p) => sum + p.amountToRefund, 0);
}

// === Refund Calculation Functions ===

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
 * Allocate refund total across selected payments (immutable)
 */
export function allocateRefundsToPayments(payments: RefundablePayment[], total: number): RefundablePayment[] {
    let refundsAllocated = 0;
    return payments.map(payment => {
        if (!payment.selected) {
            return { ...payment, amountToRefund: 0 };
        }
        const amountToRefund = Math.min(payment.refundableAmount, total - refundsAllocated);
        refundsAllocated += amountToRefund;
        return { ...payment, amountToRefund };
    });
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
