import { ConfigArg } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { of } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Customer } from '../../../entity/customer/customer.entity';
import { CustomerGroup } from '../../../entity/customer-group/customer-group.entity';
import { Order } from '../../../entity/order/order.entity';
import { createRequestContext } from '../../../testing/order-test-utils';

import { customerGroup } from './customer-group-condition';

/**
 * Unit tests for the `customer_group` promotion condition.
 *
 * The condition returns `true` when the order's customer belongs to the
 * specified customer group.  All external dependencies (CustomerService,
 * CacheService, EventBus) are replaced with lightweight mocks injected
 * via the condition's `init()` hook.
 *
 * Test cases are derived by equivalence partitioning over:
 *  - presence of a customer on the order (null vs set)
 *  - membership outcome (not a member / member of target group /
 *    member of other groups only / member of multiple groups)
 */

const mockGetCustomerGroups = vi.fn();

const mockCustomerService = {
    getCustomerGroups: mockGetCustomerGroups,
} as any;

// Pass-through cache: always invokes the fallback so group lookups hit
// the mock CustomerService directly, keeping tests deterministic.
const mockCacheService = {
    createCache: () => ({
        get: async (_id: unknown, fallback: () => Promise<unknown>) => fallback(),
        delete: async () => {},
        invalidateTags: async () => {},
    }),
} as any;

const mockEventBus = {
    ofType: () => of(),
} as any;

const mockInjector = {
    get: (token: unknown) => {
        const name = (token as { name?: string })?.name;
        if (name === 'CustomerService') return mockCustomerService;
        if (name === 'CacheService') return mockCacheService;
        if (name === 'EventBus') return mockEventBus;
    },
};

function buildArgs(customerGroupId: ID): ConfigArg[] {
    return [{ name: 'customerGroupId', value: String(customerGroupId) }] as ConfigArg[];
}

function groups(...ids: ID[]): CustomerGroup[] {
    return ids.map(id => new CustomerGroup({ id }));
}

function orderWithCustomer(customerId: ID): Order {
    return new Order({ lines: [], customer: new Customer({ id: customerId }) });
}

const ctx = createRequestContext({ pricesIncludeTax: false });

async function check(order: Order, args: ConfigArg[]) {
    return customerGroup.check(ctx, order, args, undefined as any);
}

describe('customerGroup', () => {
    beforeAll(async () => {
        await customerGroup.init(mockInjector as any);
    });

    describe('order without a customer', () => {
        it('returns false when the order has no customer', async () => {
            const order = new Order({ lines: [] });
            const args = buildArgs('g1');

            expect(await check(order, args)).toBe(false);
        });
    });

    describe('order with a customer', () => {
        it('returns false when the customer belongs to no groups', async () => {
            const order = orderWithCustomer('c1');
            const args = buildArgs('g1');
            mockGetCustomerGroups.mockResolvedValue(groups());

            expect(await check(order, args)).toBe(false);
        });

        it('returns false when the customer belongs to other groups but not the target', async () => {
            const order = orderWithCustomer('c1');
            const args = buildArgs('g-target');
            mockGetCustomerGroups.mockResolvedValue(groups('g-other-1', 'g-other-2'));

            expect(await check(order, args)).toBe(false);
        });

        it('returns true when the customer belongs to exactly the target group', async () => {
            const order = orderWithCustomer('c1');
            const args = buildArgs('g1');
            mockGetCustomerGroups.mockResolvedValue(groups('g1'));

            expect(await check(order, args)).toBe(true);
        });

        it('returns true when the customer belongs to multiple groups including the target', async () => {
            const order = orderWithCustomer('c1');
            const args = buildArgs('g-target');
            mockGetCustomerGroups.mockResolvedValue(groups('g-other', 'g-target', 'g-another'));

            expect(await check(order, args)).toBe(true);
        });

        it('passes the customer id to getCustomerGroups', async () => {
            const order = orderWithCustomer('c42');
            const args = buildArgs('g1');
            mockGetCustomerGroups.mockResolvedValue(groups('g1'));

            await check(order, args);

            expect(mockGetCustomerGroups).toHaveBeenCalledWith(ctx, 'c42');
        });
    });
});
