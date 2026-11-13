import { ID } from '@vendure/common/lib/shared-types';
import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Customer } from '../../entity/customer/customer.entity';

import { BuyerIdentityService } from './buyer-identity.service';
import { CustomerService } from './customer.service';

function createService(customers: Customer[]) {
    const cache = new Map<string, unknown>();
    const requestCache = {
        get: (ctx: RequestContext, key: string, getDefault: () => unknown) => {
            if (!cache.has(key)) {
                cache.set(key, getDefault());
            }
            return cache.get(key);
        },
        set: (ctx: RequestContext, key: string, value: unknown) => cache.set(key, value),
    };
    const findOneCalls: ID[] = [];
    const customerService = {
        // CustomerService.findOne() gives no Customer that is deleted or not in the active Channel
        findOne: (ctx: RequestContext, id: ID) => {
            findOneCalls.push(id);
            return Promise.resolve(customers.find(c => c.id === id));
        },
    };
    const service = new BuyerIdentityService(
        requestCache as unknown as RequestContextCacheService,
        customerService as unknown as CustomerService,
    );
    return { service, findOneCalls };
}

describe('BuyerIdentityService.forCustomer()', () => {
    const ctx = RequestContext.empty();

    it('loads nothing until a method is called', () => {
        const { service, findOneCalls } = createService([]);

        service.forCustomer(ctx, 1);

        expect(findOneCalls).toEqual([]);
    });

    it('gives the ID of a Customer that CustomerService finds, and loads it once', async () => {
        const customer = new Customer({ id: 1 });
        const { service, findOneCalls } = createService([customer]);
        const buyer = service.forCustomer(ctx, 1);

        expect(await buyer.getCustomerId()).toBe(1);
        expect(await buyer.getCustomer()).toBe(customer);
        expect(findOneCalls).toEqual([1]);
    });

    it('gives no ID for a Customer that is deleted or not in the active Channel', async () => {
        const { service } = createService([]);
        const buyer = service.forCustomer(ctx, 2);

        expect(await buyer.getCustomerId()).toBeUndefined();
        expect(await buyer.getCustomer()).toBeUndefined();
    });

    it('gives no Customer and runs no query for a buyer without a Customer', async () => {
        const { service, findOneCalls } = createService([]);
        const buyer = service.forCustomer(ctx, null);

        expect(await buyer.getCustomerId()).toBeUndefined();
        expect(findOneCalls).toEqual([]);
    });
});
