import { ConfigArg } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { createRequestContext } from '../../../testing/order-test-utils';
import { ensureConfigLoaded } from '../../config-helpers';

import { buyXGetYFreeCondition } from './buy-x-get-y-free-condition';

/**
 * Unit tests for the `buy_x_get_y_free` promotion condition.
 *
 * Test cases are derived from the logic of `check()` using equivalence
 * partitioning and boundary-value analysis over the two numeric drivers:
 *
 *  - `quantity = floor(matches / amountX)` — the "buy X" gate.
 *  - `min(line.quantity, placesToAllocate)` — the "get Y free" allocation,
 *    applied to candidate lines ordered cheapest-first.
 *
 * The condition returns `false` when it does not apply, or
 * `{ freeItemsPerLine }` (a truthy object) when it does.
 */

/** Build the serialized `ConfigArg[]` the way the framework passes them to `check()`. */
function buildArgs(input: {
    amountX: number;
    variantIdsX: Array<ID>;
    amountY: number;
    variantIdsY: Array<ID>;
}): ConfigArg[] {
    return [
        { name: 'amountX', value: String(input.amountX) },
        { name: 'variantIdsX', value: JSON.stringify(input.variantIdsX.map(String)) },
        { name: 'amountY', value: String(input.amountY) },
        { name: 'variantIdsY', value: JSON.stringify(input.variantIdsY.map(String)) },
    ] as ConfigArg[];
}

/** Build an OrderLine with a controllable unit price (for the cheapest-first ordering). */
function line(opts: {
    lineId: ID;
    variantId: ID;
    quantity: number;
    listPrice?: number;
    listPriceIncludesTax?: boolean;
    taxRate?: number;
}): OrderLine {
    return new OrderLine({
        id: opts.lineId,
        productVariant: new ProductVariant({ id: opts.variantId }),
        quantity: opts.quantity,
        listPrice: opts.listPrice ?? 0,
        listPriceIncludesTax: opts.listPriceIncludesTax ?? false,
        taxLines: opts.taxRate ? [{ description: 'test tax', taxRate: opts.taxRate }] : [],
    });
}

function orderWith(lines: OrderLine[]): Order {
    return new Order({ lines });
}

function check(ctx: RequestContext, order: Order, args: ConfigArg[]) {
    // The fourth `promotion` argument is unused by this condition's check function.
    return buyXGetYFreeCondition.check(ctx, order, args, undefined as any);
}

describe('buyXGetYFreeCondition', () => {
    const ctx = createRequestContext({ pricesIncludeTax: false });

    // The cheapest-first ordering reads `OrderLine.unitPrice`, which rounds via the
    // configured MoneyStrategy, so the global config must be loaded first.
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    describe('buy-X threshold (boundary-value on floor(matches / amountX))', () => {
        it('returns false when no X variant is present in the order (matches = 0)', async () => {
            const order = orderWith([line({ lineId: 'l1', variantId: 'y1', quantity: 5 })]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['x1'], amountY: 1, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toBe(false);
        });

        it('returns false when matches is one below the threshold', async () => {
            // amountX = 2, only 1 matching item -> floor(1 / 2) = 0
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 1 }),
                line({ lineId: 'l2', variantId: 'y1', quantity: 5 }),
            ]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['x1'], amountY: 1, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toBe(false);
        });

        it('applies when matches exactly equals the threshold', async () => {
            // amountX = 2, exactly 2 matching items -> floor(2 / 2) = 1
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'l2', variantId: 'y1', quantity: 5 }),
            ]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['x1'], amountY: 1, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { l2: 1 } });
        });
    });

    describe('free-item candidates (equivalence partitioning)', () => {
        it('returns false when the threshold is met but no Y variant is present', async () => {
            const order = orderWith([line({ lineId: 'l1', variantId: 'x1', quantity: 4 })]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['x1'], amountY: 1, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toBe(false);
        });
    });

    describe('free-item allocation (boundary-value on min(quantity, placesToAllocate))', () => {
        it('allocates amountY free items to a single candidate line', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'l2', variantId: 'y1', quantity: 5 }),
            ]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['x1'], amountY: 3, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { l2: 3 } });
        });

        it('caps allocation at a line quantity and spills the remainder to the next line', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'cheap', variantId: 'y1', quantity: 5, listPrice: 50 }),
                line({ lineId: 'dear', variantId: 'y2', quantity: 5, listPrice: 100 }),
            ]);
            const args = buildArgs({
                amountX: 2,
                variantIdsX: ['x1'],
                amountY: 7,
                variantIdsY: ['y1', 'y2'],
            });

            // 7 free places: 5 from the cheapest line, 2 spilling into the next.
            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { cheap: 5, dear: 2 } });
        });

        it('does not over-allocate when amountY exceeds the total candidate quantity', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'cheap', variantId: 'y1', quantity: 5, listPrice: 50 }),
                line({ lineId: 'dear', variantId: 'y2', quantity: 5, listPrice: 100 }),
            ]);
            const args = buildArgs({
                amountX: 2,
                variantIdsX: ['x1'],
                amountY: 20,
                variantIdsY: ['y1', 'y2'],
            });

            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { cheap: 5, dear: 5 } });
        });
    });

    describe('cheapest-first ordering', () => {
        it('allocates to the cheapest candidate line first (by unitPrice when prices exclude tax)', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'dear', variantId: 'y1', quantity: 5, listPrice: 100 }),
                line({ lineId: 'cheap', variantId: 'y2', quantity: 5, listPrice: 50 }),
            ]);
            const args = buildArgs({
                amountX: 2,
                variantIdsX: ['x1'],
                amountY: 1,
                variantIdsY: ['y1', 'y2'],
            });

            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { cheap: 1 } });
        });

        it('keeps both candidate lines available when their prices are equal', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'first', variantId: 'y1', quantity: 2, listPrice: 50 }),
                line({ lineId: 'second', variantId: 'y2', quantity: 2, listPrice: 50 }),
            ]);
            const args = buildArgs({
                amountX: 2,
                variantIdsX: ['x1'],
                amountY: 3,
                variantIdsY: ['y1', 'y2'],
            });

            // Equal unit prices: the comparator returns 0, the original order is kept,
            // so the 3 free places fill the first line then spill into the second.
            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { first: 2, second: 1 } });
        });

        it('orders by unitPriceWithTax when the channel prices include tax', async () => {
            const ctxIncl = createRequestContext({ pricesIncludeTax: true });
            // lineA: net 100, gross 100 (no tax).  lineB: net 90, gross 135 (50% tax).
            // By unitPrice (net):       B (90)  < A (100)  -> cheapest is B
            // By unitPriceWithTax (gross): A (100) < B (135) -> cheapest is A
            // listPriceIncludesTax is left at its default false so listPrice is the net price,
            // making unitPriceWithTax = listPrice * (1 + taxRate) as shown above.
            const lineA = line({ lineId: 'a', variantId: 'y1', quantity: 5, listPrice: 100 });
            const lineB = line({ lineId: 'b', variantId: 'y2', quantity: 5, listPrice: 90, taxRate: 50 });
            const order = orderWith([line({ lineId: 'x', variantId: 'x1', quantity: 2 }), lineA, lineB]);
            const args = buildArgs({
                amountX: 2,
                variantIdsX: ['x1'],
                amountY: 1,
                variantIdsY: ['y1', 'y2'],
            });

            // With tax-inclusive ordering, lineA is the cheapest gross price.
            expect(await check(ctxIncl, order, args)).toEqual({ freeItemsPerLine: { a: 1 } });
        });
    });

    describe('variant in both the X and Y sets', () => {
        it('counts an overlapping variant toward both matches and free candidates', async () => {
            const order = orderWith([line({ lineId: 'l1', variantId: 'v', quantity: 2 })]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['v'], amountY: 1, variantIdsY: ['v'] });

            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: { l1: 1 } });
        });
    });

    describe('documented edge-case behaviour', () => {
        it('returns an empty allocation (still truthy) when amountY is 0', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'l2', variantId: 'y1', quantity: 5 }),
            ]);
            const args = buildArgs({ amountX: 2, variantIdsX: ['x1'], amountY: 0, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toEqual({ freeItemsPerLine: {} });
        });

        // amountX = 0 makes floor(matches / 0) = Infinity, which bypassed the `!quantity` guard.
        it('returns false when amountX is 0 (no division-by-zero bypass)', async () => {
            const order = orderWith([
                line({ lineId: 'l1', variantId: 'x1', quantity: 2 }),
                line({ lineId: 'l2', variantId: 'y1', quantity: 5 }),
            ]);
            const args = buildArgs({ amountX: 0, variantIdsX: ['x1'], amountY: 1, variantIdsY: ['y1'] });

            expect(await check(ctx, order, args)).toBe(false);
        });
    });
});
