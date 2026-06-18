import { INestApplicationContext } from '@nestjs/common';
import { CustomerService, isGraphQlErrorResult, RequestContext } from '@vendure/core';

import { getSuperadminContext } from '../utils/get-superadmin-context';

import { MockDataService } from './mock-data.service';

/**
 * Creates customers with addresses by making API calls to the Admin API.
 */
export async function populateCustomers(
    app: INestApplicationContext,
    count: number,
    loggingFn: (message: string) => void,
) {
    const customerService = app.get(CustomerService);
    const customerData = MockDataService.getCustomers(count);
    const ctx = await getSuperadminContext(app);
    const password = 'test';
    for (const { customer, address } of customerData) {
        try {
            const createdCustomer = await customerService.create(ctx, customer, password);
            if (isGraphQlErrorResult(createdCustomer)) {
                loggingFn(`Failed to create customer: ${createdCustomer.message}`);
                continue;
            }
            await customerService.createAddress(ctx, createdCustomer.id, address);
        } catch (e: any) {
            loggingFn(`Failed to create customer: ${JSON.stringify(e.message)}`);
        }
    }
}
