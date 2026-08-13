import { ConfigArg } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { Order } from '../../../entity/order/order.entity';
import { createRequestContext } from '../../../testing/order-test-utils';

import { minimumOrderAmount } from './min-order-amount-condition';

function buildArgs(amount: number, taxInclusive: boolean): ConfigArg[] {
    return [
        { name: 'amount', value: String(amount) },
        { name: 'taxInclusive', value: taxInclusive ? 'true' : 'false' },
    ] as ConfigArg[];
}

function orderWith(values: { subTotal: number; subTotalWithTax: number }): Order {
    return new Order({ lines: [], subTotal: values.subTotal, subTotalWithTax: values.subTotalWithTax });
}

function check(order: Order, args: ConfigArg[]) {
    const ctx = createRequestContext({ pricesIncludeTax: false });
    return minimumOrderAmount.check(ctx, order, args, undefined as any);
}

describe('minimumOrderAmount', () => {
    describe('tax-exclusive mode (taxInclusive = false)', () => {
        const args = buildArgs(100, false);

        it('returns false when subTotal is one below the threshold', async () => {
            expect(await check(orderWith({ subTotal: 99, subTotalWithTax: 109 }), args)).toBe(false);
        });

        it('returns true when subTotal exactly equals the threshold (boundary)', async () => {
            expect(await check(orderWith({ subTotal: 100, subTotalWithTax: 110 }), args)).toBe(true);
        });

        it('returns true when subTotal exceeds the threshold', async () => {
            expect(await check(orderWith({ subTotal: 150, subTotalWithTax: 165 }), args)).toBe(true);
        });

        it('uses subTotal and ignores subTotalWithTax', async () => {
            // subTotalWithTax is above the threshold, subTotal is below — should still be false.
            expect(await check(orderWith({ subTotal: 50, subTotalWithTax: 120 }), args)).toBe(false);
        });
    });

    describe('tax-inclusive mode (taxInclusive = true)', () => {
        const args = buildArgs(100, true);

        it('returns false when subTotalWithTax is one below the threshold', async () => {
            expect(await check(orderWith({ subTotal: 90, subTotalWithTax: 99 }), args)).toBe(false);
        });

        it('returns true when subTotalWithTax exactly equals the threshold (boundary)', async () => {
            expect(await check(orderWith({ subTotal: 90, subTotalWithTax: 100 }), args)).toBe(true);
        });

        it('returns true when subTotalWithTax exceeds the threshold', async () => {
            expect(await check(orderWith({ subTotal: 90, subTotalWithTax: 150 }), args)).toBe(true);
        });

        it('uses subTotalWithTax and ignores subTotal', async () => {
            // subTotal is above the threshold, subTotalWithTax is below — should still be false.
            expect(await check(orderWith({ subTotal: 200, subTotalWithTax: 80 }), args)).toBe(false);
        });
    });
});
