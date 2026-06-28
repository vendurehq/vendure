import { ConfigArg } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { describe, expect, it } from 'vitest';

import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { createRequestContext } from '../../../testing/order-test-utils';

import { containsProducts } from './contains-products-condition';

/**
 * Unit tests for the `contains_products` promotion condition.
 *
 * The condition returns `true` when the total quantity of lines whose variant
 * is in `productVariantIds` is at least `minimum`.
 *
 * Test cases are derived by:
 *  - equivalence partitioning over the match count vs minimum
 *  - boundary-value analysis at `matches = minimum ± 1`
 *  - edge cases for multiple eligible lines
 */

function buildArgs(minimum: number, productVariantIds: ID[]): ConfigArg[] {
    return [
        { name: 'minimum', value: String(minimum) },
        { name: 'productVariantIds', value: JSON.stringify(productVariantIds.map(String)) },
    ] as ConfigArg[];
}

function line(variantId: ID, quantity: number): OrderLine {
    return new OrderLine({
        productVariant: new ProductVariant({ id: variantId }),
        quantity,
    });
}

function orderWith(lines: OrderLine[]): Order {
    return new Order({ lines });
}

const ctx = createRequestContext({ pricesIncludeTax: false });

function check(order: Order, args: ConfigArg[]) {
    return containsProducts.check(ctx, order, args, undefined as any);
}

describe('containsProducts', () => {
    describe('boundary-value analysis on total matching quantity vs minimum', () => {
        it('returns false when no eligible variant is present (matches = 0, minimum = 1)', async () => {
            const order = orderWith([line('other', 5)]);
            const args = buildArgs(1, ['v1']);

            expect(await check(order, args)).toBe(false);
        });

        it('returns false when matching quantity is one below the minimum', async () => {
            // minimum = 3, matches = 2 → false
            const order = orderWith([line('v1', 2)]);
            const args = buildArgs(3, ['v1']);

            expect(await check(order, args)).toBe(false);
        });

        it('returns true when matching quantity exactly equals the minimum (boundary)', async () => {
            // minimum = 3, matches = 3 → true
            const order = orderWith([line('v1', 3)]);
            const args = buildArgs(3, ['v1']);

            expect(await check(order, args)).toBe(true);
        });

        it('returns true when matching quantity exceeds the minimum', async () => {
            const order = orderWith([line('v1', 5)]);
            const args = buildArgs(3, ['v1']);

            expect(await check(order, args)).toBe(true);
        });
    });

    describe('quantity accumulation across multiple lines', () => {
        it('sums quantities across multiple lines with matching variants', async () => {
            // Two lines, each with quantity 2 → matches = 4 ≥ minimum 3
            const order = orderWith([line('v1', 2), line('v2', 2)]);
            const args = buildArgs(3, ['v1', 'v2']);

            expect(await check(order, args)).toBe(true);
        });

        it('ignores lines whose variant is not in the eligible set', async () => {
            // 'other' is not in productVariantIds → only v1 qty 1 counts; 1 < 3
            const order = orderWith([line('v1', 1), line('other', 10)]);
            const args = buildArgs(3, ['v1']);

            expect(await check(order, args)).toBe(false);
        });
    });


});
