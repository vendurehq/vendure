import { CreateAddressInput, CreateCustomerInput } from '@vendure/common/lib/generated-types';
import faker from 'faker/locale/en_GB';
import gql from 'graphql-tag';

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

    /**
     * @deprecated
     * Use `MockDataService.getCustomers()` and create customers directly with CustomerService.
     */
    async populateCustomers(count: number = 5): Promise<any> {
        for (let i = 0; i < count; i++) {
            const firstName = faker.name.firstName();
            const lastName = faker.name.lastName();

            const query1 = gql`
                mutation CreateCustomer($input: CreateCustomerInput!, $password: String) {
                    createCustomer(input: $input, password: $password) {
                        ... on Customer {
                            id
                            emailAddress
                        }
                    }
                }
            `;

            const variables1 = {
                input: {
                    firstName,
                    lastName,
                    emailAddress: faker.internet.email(firstName, lastName),
                    phoneNumber: faker.phone.phoneNumber(),
                },
                password: 'test',
            };

            const customer: { id: string; emailAddress: string } | void = await this.client
                .query(query1, variables1)
                .then(
                    (data: any) => data.createCustomer,
                    err => this.log(err),
                );

            if (customer) {
                const query2 = gql`
                    mutation ($customerId: ID!, $input: CreateAddressInput!) {
                        createCustomerAddress(customerId: $customerId, input: $input) {
                            id
                            streetLine1
                        }
                    }
                `;

                const variables2 = {
                    input: {
                        fullName: `${firstName} ${lastName}`,
                        streetLine1: faker.address.streetAddress(),
                        city: faker.address.city(),
                        province: faker.address.county(),
                        postalCode: faker.address.zipCode(),
                        countryCode: 'GB',
                    },
                    customerId: customer.id,
                };

                await this.client.query(query2, variables2).catch(err => this.log(err));
            }
        }
        this.log(`Created ${count} Customers`);
    }

    private log(...args: any[]) {
        if (this.logging) {
            console.log(...args);
        }
    }
}
