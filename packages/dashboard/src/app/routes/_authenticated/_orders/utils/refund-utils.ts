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
