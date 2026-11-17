import { CreateAddressInput, CreateCustomerInput } from '@vendure/common/lib/generated-types';
import faker from 'faker/locale/en_GB';

import { SimpleGraphQLClient } from '../simple-graphql-client';

/* eslint-disable no-console */
/**
 * A service for creating mock data via the GraphQL API.
 */
export class MockDataService {
    apiUrl: string;

    constructor(private client: SimpleGraphQLClient, private logging = true) {
        // make the generated results deterministic
        faker.seed(1);
    }

    static getCustomers(
        count: number,
    ): Array<{ customer: CreateCustomerInput; address: CreateAddressInput }> {
        faker.seed(1);
        const results: Array<{ customer: CreateCustomerInput; address: CreateAddressInput }> = [];
        for (let i = 0; i < count; i++) {
            const firstName = faker.name.firstName();
            const lastName = faker.name.lastName();
            const customer: CreateCustomerInput = {
                firstName,
                lastName,
                emailAddress: faker.internet.email(firstName, lastName),
                phoneNumber: faker.phone.phoneNumber(),
            };
            const address: CreateAddressInput = {
                fullName: `${firstName} ${lastName}`,
                streetLine1: faker.address.streetAddress(),
                city: faker.address.city(),
                province: faker.address.county(),
                postalCode: faker.address.zipCode(),
                countryCode: 'GB',
            };
            results.push({ customer, address });
        }
        return results;
    }

    private log(...args: any[]) {
        if (this.logging) {
            console.log(...args);
        }
    }
}
