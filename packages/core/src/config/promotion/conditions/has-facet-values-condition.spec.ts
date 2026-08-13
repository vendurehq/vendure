import { ConfigArg } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { FacetValueChecker } from '../../../service/helpers/facet-value-checker/facet-value-checker';
import { createRequestContext } from '../../../testing/order-test-utils';

import { hasFacetValues } from './has-facet-values-condition';

/**
 * Unit tests for the `at_least_n_with_facets` promotion condition.
 *
 * The condition uses `FacetValueChecker.hasFacetValues()` to decide whether
 * each order line qualifies, then sums matching quantities and compares with
 * `minimum`.  We inject a mock checker via `init()` to avoid database access.
 *
 * Test cases are derived by:
 *  - equivalence partitioning: zero / some / all lines match
 *  - boundary-value analysis: `matches = minimum ± 1` and `matches = minimum`
 */

const mockHasFacetValues = vi.fn<
    Parameters<FacetValueChecker['hasFacetValues']>,
    ReturnType<FacetValueChecker['hasFacetValues']>
>();

const mockFacetValueChecker = {
    hasFacetValues: mockHasFacetValues,
} as unknown as FacetValueChecker;

const mockInjector = {
    get: (token: unknown) => {
        if (token === FacetValueChecker) return mockFacetValueChecker;
    },
};

function buildArgs(minimum: number, facets: ID[]): ConfigArg[] {
    return [
        { name: 'minimum', value: String(minimum) },
        { name: 'facets', value: JSON.stringify(facets.map(String)) },
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

async function check(order: Order, args: ConfigArg[]) {
    return hasFacetValues.check(ctx, order, args, undefined as any);
}

describe('hasFacetValues', () => {
    beforeAll(async () => {
        await hasFacetValues.init(mockInjector as any);
    });

    describe('boundary-value analysis on total matching quantity vs minimum', () => {
        it('returns false when no line has matching facet values (matches = 0, minimum = 1)', async () => {
            const order = orderWith([line('v1', 5)]);
            const args = buildArgs(1, ['f1']);
            mockHasFacetValues.mockResolvedValue(false);

            expect(await check(order, args)).toBe(false);
        });

        it('returns false when matching quantity is one below the minimum', async () => {
            // minimum = 3, the single matching line has quantity 2 → false
            const order = orderWith([line('v1', 2), line('v2', 10)]);
            const args = buildArgs(3, ['f1']);
            mockHasFacetValues.mockImplementation(async (l: OrderLine) => l === order.lines[0]);

            expect(await check(order, args)).toBe(false);
        });

        it('returns true when matching quantity exactly equals the minimum (boundary)', async () => {
            const order = orderWith([line('v1', 3)]);
            const args = buildArgs(3, ['f1']);
            mockHasFacetValues.mockResolvedValue(true);

            expect(await check(order, args)).toBe(true);
        });

        it('returns true when matching quantity exceeds the minimum', async () => {
            const order = orderWith([line('v1', 5)]);
            const args = buildArgs(3, ['f1']);
            mockHasFacetValues.mockResolvedValue(true);

            expect(await check(order, args)).toBe(true);
        });
    });

    describe('quantity accumulation across multiple lines', () => {
        it('sums quantities across all lines that have matching facet values', async () => {
            // Two matching lines, qty 2 each → matches = 4 ≥ minimum 3
            const order = orderWith([line('v1', 2), line('v2', 2)]);
            const args = buildArgs(3, ['f1']);
            mockHasFacetValues.mockResolvedValue(true);

            expect(await check(order, args)).toBe(true);
        });

        it('excludes lines that do not have the required facet values', async () => {
            const order = orderWith([line('v1', 1), line('v2', 10)]);
            const args = buildArgs(3, ['f1']);
            // Only v1 has the facet value; v2 does not
            mockHasFacetValues.mockImplementation(async (l: OrderLine) => l === order.lines[0]);

            // matches = 1, minimum = 3 → false
            expect(await check(order, args)).toBe(false);
        });
    });

    describe('checker invocation', () => {
        it('passes the ctx and facet ID list to hasFacetValues', async () => {
            mockHasFacetValues.mockClear();
            const order = orderWith([line('v1', 1)]);
            const args = buildArgs(1, ['f1', 'f2']);
            mockHasFacetValues.mockResolvedValue(true);

            await check(order, args);

            expect(mockHasFacetValues).toHaveBeenCalledTimes(1);
            expect(mockHasFacetValues).toHaveBeenCalledWith(order.lines[0], ['f1', 'f2'], ctx);
        });
    });
});
