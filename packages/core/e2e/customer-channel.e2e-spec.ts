/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { ResultOf } from './graphql/graphql-admin';
import {
    addCustomersToGroupDocument,
    createAddressDocument,
    createChannelDocument,
    createCustomerDocument,
    createCustomerGroupDocument,
    deleteCustomerDocument,
    getCustomerGroupDocument,
    getCustomerListDocument,
    MeDocument,
    removeCustomersFromGroupDocument,
    updateAddressDocument,
    updateCustomerDocument,
} from './graphql/shared-definitions';
import { deleteAddressDocument, registerAccountDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

type CustomerListItem = ResultOf<typeof getCustomerListDocument>['customers']['items'][number];

describe('ChannelAware Customers', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    const SECOND_CHANNEL_TOKEN = 'second_channel_token';
    let firstCustomer: CustomerListItem;
    let secondCustomer: CustomerListItem;
    let thirdCustomer: CustomerListItem;
    const numberOfCustomers = 3;
    let customerGroupId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: numberOfCustomers,
        });
        await adminClient.asSuperAdmin();

        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { take: numberOfCustomers },
        });
        firstCustomer = customers.items[0];
        secondCustomer = customers.items[1];
        thirdCustomer = customers.items[2];

        await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.GBP,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });

        const { createCustomerGroup } = await adminClient.query(createCustomerGroupDocument, {
            input: {
                name: 'TestGroup',
            },
        });
        customerGroupId = createCustomerGroup.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('Address manipulation', () => {
        it(
            'throws when updating address from customer from other channel',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(updateAddressDocument, {
                    input: {
                        id: 'T_1',
                        streetLine1: 'Dummy street',
                    },
                });
            }, 'No Address with the id "1" could be found'),
        );

        it(
            'throws when creating address for customer from other channel',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(createAddressDocument, {
                    id: firstCustomer.id,
                    input: {
                        streetLine1: 'Dummy street',
                        countryCode: 'BE',
                    },
                });
            }, 'No Customer with the id "1" could be found'),
        );

        it(
            'throws when deleting address from customer from other channel',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(deleteAddressDocument, {
                    id: 'T_1',
                });
            }, 'No Address with the id "1" could be found'),
        );
    });

    describe('Customer manipulation', () => {
        it(
            'throws when deleting customer from other channel',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(deleteCustomerDocument, {
                    id: firstCustomer.id,
                });
            }, 'No Customer with the id "1" could be found'),
        );

        it(
            'throws when updating customer from other channel',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(updateCustomerDocument, {
                    input: {
                        id: firstCustomer.id,
                        firstName: 'John',
                        lastName: 'Doe',
                    },
                });
            }, 'No Customer with the id "1" could be found'),
        );

        it('creates customers on current and default channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(createCustomerDocument, {
                input: {
                    firstName: 'John',
                    lastName: 'Doe',
                    emailAddress: 'john.doe@test.com',
                },
            });
            const customersSecondChannel = await adminClient.query(getCustomerListDocument);
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const customersDefaultChannel = await adminClient.query(getCustomerListDocument);

            expect(customersSecondChannel.customers.totalItems).toBe(1);
            expect(customersDefaultChannel.customers.totalItems).toBe(numberOfCustomers + 1);
        });

        it('only shows customers from current channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { customers } = await adminClient.query(getCustomerListDocument);
            expect(customers.totalItems).toBe(1);
        });

        it('shows all customers on default channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { customers } = await adminClient.query(getCustomerListDocument);
            expect(customers.totalItems).toBe(numberOfCustomers + 1);
        });

        it('brings customer to current channel when creating with existing emailAddress', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            let customersDefaultChannel = await adminClient.query(getCustomerListDocument);
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            let customersSecondChannel = await adminClient.query(getCustomerListDocument);
            expect(customersDefaultChannel.customers.items.map(customer => customer.emailAddress)).toContain(
                firstCustomer.emailAddress,
            );
            expect(
                customersSecondChannel.customers.items.map(customer => customer.emailAddress),
            ).not.toContain(firstCustomer.emailAddress);

            await adminClient.query(createCustomerDocument, {
                input: {
                    firstName: firstCustomer.firstName + '_new',
                    lastName: firstCustomer.lastName + '_new',
                    emailAddress: firstCustomer.emailAddress,
                },
            });

            customersSecondChannel = await adminClient.query(getCustomerListDocument);
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            customersDefaultChannel = await adminClient.query(getCustomerListDocument);
            const firstCustomerOnNewChannel = customersSecondChannel.customers.items.find(
                customer => customer.emailAddress === firstCustomer.emailAddress,
            );
            const firstCustomerOnDefaultChannel = customersDefaultChannel.customers.items.find(
                customer => customer.emailAddress === firstCustomer.emailAddress,
            );

            expect(firstCustomerOnNewChannel).not.toBeNull();
            expect(firstCustomerOnNewChannel?.emailAddress).toBe(firstCustomer.emailAddress);
            expect(firstCustomerOnNewChannel?.firstName).toBe(firstCustomer.firstName + '_new');
            expect(firstCustomerOnNewChannel?.lastName).toBe(firstCustomer.lastName + '_new');

            expect(firstCustomerOnDefaultChannel).not.toBeNull();
            expect(firstCustomerOnDefaultChannel?.emailAddress).toBe(firstCustomer.emailAddress);
            expect(firstCustomerOnDefaultChannel?.firstName).toBe(firstCustomer.firstName + '_new');
            expect(firstCustomerOnDefaultChannel?.lastName).toBe(firstCustomer.lastName + '_new');
        });
    });

    describe('Shop API', () => {
        it('assigns authenticated customers to the channels they visit', async () => {
            shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await shopClient.asUserWithCredentials(secondCustomer.emailAddress, 'test');
            await shopClient.query(MeDocument);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { customers } = await adminClient.query(getCustomerListDocument);
            expect(customers.totalItems).toBe(3);
            expect(customers.items.map(customer => customer.emailAddress)).toContain(
                secondCustomer.emailAddress,
            );
        });

        it('assigns newly registered customers to channel', async () => {
            shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await shopClient.asAnonymousUser();
            await shopClient.query(registerAccountDocument, {
                input: {
                    emailAddress: 'john.doe.2@test.com',
                },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { customers } = await adminClient.query(getCustomerListDocument);
            expect(customers.totalItems).toBe(4);
            expect(customers.items.map(customer => customer.emailAddress)).toContain('john.doe.2@test.com');
        });

        // https://github.com/vendurehq/vendure/issues/834
        it('handles concurrent assignments to a new channel', async () => {
            const THIRD_CHANNEL_TOKEN = 'third_channel_token';
            await adminClient.query(createChannelDocument, {
                input: {
                    code: 'third-channel',
                    token: THIRD_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });

            await shopClient.asUserWithCredentials(secondCustomer.emailAddress, 'test');
            shopClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            try {
                await Promise.all([shopClient.query(MeDocument), shopClient.query(MeDocument)]);
            } catch (e: any) {
                fail('Threw: ' + (e.message as string));
            }

            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);
            const { customers } = await adminClient.query(getCustomerListDocument);
            expect(customers.totalItems).toBe(1);
            expect(customers.items.map(customer => customer.emailAddress)).toContain(
                secondCustomer.emailAddress,
            );
        });
    });

    describe('Customergroup manipulation', () => {
        it('does not add a customer from another channel to customerGroup', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(addCustomersToGroupDocument, {
                groupId: customerGroupId,
                customerIds: [thirdCustomer.id],
            });

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { customerGroup } = await adminClient.query(getCustomerGroupDocument, {
                id: customerGroupId,
            });
            expect(customerGroup!.customers.totalItems).toBe(0);
        });

        it('only shows customers from current channel in customerGroup', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(addCustomersToGroupDocument, {
                groupId: customerGroupId,
                customerIds: [secondCustomer.id, thirdCustomer.id],
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { customerGroup } = await adminClient.query(getCustomerGroupDocument, {
                id: customerGroupId,
            });
            expect(customerGroup!.customers.totalItems).toBe(1);
            expect(customerGroup!.customers.items.map(customer => customer.id)).toContain(secondCustomer.id);
        });

        it('throws when deleting customer from other channel from customerGroup', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(removeCustomersFromGroupDocument, {
                groupId: customerGroupId,
                customerIds: [thirdCustomer.id],
            });
        });
    });
});
