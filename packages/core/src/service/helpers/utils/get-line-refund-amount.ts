/**
 * @description
 * Allocates the tax-inclusive value of an OrderLine across successive refunds. The parts come from
 * `OrderLine.getRefundPriceParts()`: each earlier cancellation, then the remaining units. Refunds
 * take the parts in order, skipping `alreadyRefunded` units. Each part is rounded cumulatively, so
 * the refunds of a part add up to exactly its value. Without parts, the refund is
 * `proratedUnitPriceWithTax * quantity`.
 */
export function getLineRefundAmount(
    line: {
        proratedUnitPriceWithTax: number;
        getRefundPriceParts(): ReadonlyArray<{ priceWithTax: number; quantity: number }>;
    },
    quantity: number,
    alreadyRefunded: number,
): number {
    const parts = line.getRefundPriceParts();
    if (!parts.length) {
        return line.proratedUnitPriceWithTax * quantity;
    }
    let amount = 0;
    for (const part of parts) {
        const skip = Math.min(part.quantity, alreadyRefunded);
        alreadyRefunded -= skip;
        const remaining = part.quantity - skip;
        const take = Math.min(remaining, quantity);
        if (take > 0) {
            // Bigint money columns support totals up to Number.MAX_SAFE_INTEGER.
            const divisor = BigInt(part.quantity);
            const priceForQuantity = (count: number) =>
                Number((BigInt(part.priceWithTax) * BigInt(count) + divisor / BigInt(2)) / divisor);
            amount += priceForQuantity(remaining) - priceForQuantity(remaining - take);
            quantity -= take;
            if (quantity === 0) break;
        }
    }
    return amount;
}
