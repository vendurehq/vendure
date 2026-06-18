/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode, HistoryEntryType } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { ResultOf, VariablesOf } from './graphql/graphql-admin';
import {
    attemptLoginDocument,
    getCustomerDocument,
    getCustomerHistoryDocument,
    getCustomerIdsDocument,
} from './graphql/shared-definitions';
import {
    createAddressDocument,
    deleteAddressDocument,
    updateAddressDocument,
    updateCustomerDocument,
    updatePasswordDocument,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

type CreateAddressInput = VariablesOf<typeof createAddressDocument>['input'];
type UpdateAddressInput = VariablesOf<typeof updateAddressDocument>['input'];

describe('Shop customers', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    let customer: NonNullable<ResultOf<typeof getCustomerDocument>['customer']>;

    const successErrorGuard: ErrorResultGuard<{ success: boolean }> = createErrorResultGuard(
        input => input.success != null,
    );

    type CustomersResult = ResultOf<typeof getCustomerIdsDocument>['customers'];
    const customersGuard: ErrorResultGuard<CustomersResult> = createErrorResultGuard(
        input => input.items != null && input.items.length > 0,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();

        // Fetch the first Customer and store it as the `customer` variable.
        const { customers } = await adminClient.query(getCustomerIdsDocument);
        customersGuard.assertSuccess(customers);
        const result = await adminClient.query(getCustomerDocument, {
            id: customers.items[0].id,
        });
        customer = result.customer!;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it(
        'updateCustomer throws if not logged in',
        assertThrowsWithMessage(async () => {
            const input = {
                firstName: 'xyz',
            };
            await shopClient.query(updateCustomerDocument, {
                input,
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it(
        'createCustomerAddress throws if not logged in',
        assertThrowsWithMessage(async () => {
            const input: CreateAddressInput = {
                streetLine1: '1 Test Street',
                countryCode: 'GB',
            };
            await shopClient.query(createAddressDocument, {
                input,
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it(
        'updateCustomerAddress throws if not logged in',
        assertThrowsWithMessage(async () => {
            const input: UpdateAddressInput = {
                id: 'T_1',
                streetLine1: 'zxc',
            };
            await shopClient.query(updateAddressDocument, {
                input,
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it(
        'deleteCustomerAddress throws if not logged in',
        assertThrowsWithMessage(async () => {
            await shopClient.query(deleteAddressDocument, {
                id: 'T_1',
            });
        }, 'You are not currently authorized to perform this action'),
    );

    describe('logged in Customer', () => {
        let addressId: string;

        beforeAll(async () => {
            await shopClient.query(attemptLoginDocument, {
                username: customer.emailAddress,
                password: 'test',
                rememberMe: false,
            });
        });

        it('updateCustomer works', async () => {
            const input = {
                firstName: 'xyz',
            };
            const result = await shopClient.query(updateCustomerDocument, { input });

            expect(result.updateCustomer.firstName).toBe('xyz');
        });

        it('customer history for CUSTOMER_DETAIL_UPDATED', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer.id,
                options: {
                    // skip populated CUSTOMER_ADDRESS_CREATED entry
                    skip: 3,
                },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_DETAIL_UPDATED,
                    data: {
                        input: { firstName: 'xyz', id: 'T_1' },
                    },
                },
            ]);
        });

        it('createCustomerAddress works', async () => {
            const input: CreateAddressInput = {
                streetLine1: '1 Test Street',
                countryCode: 'GB',
            };
            const { createCustomerAddress } = await shopClient.query(createAddressDocument, { input });

            expect(createCustomerAddress).toEqual({
                id: 'T_3',
                streetLine1: '1 Test Street',
                country: {
                    code: 'GB',
                },
            });
            addressId = createCustomerAddress.id;
        });

        it('customer history for CUSTOMER_ADDRESS_CREATED', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer.id,
                options: {
                    // skip populated CUSTOMER_ADDRESS_CREATED, CUSTOMER_DETAIL_UPDATED entries
                    skip: 4,
                },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_ADDRESS_CREATED,
                    data: {
                        address: '1 Test Street, United Kingdom',
                    },
                },
            ]);
        });

        it('updateCustomerAddress works', async () => {
            const input: UpdateAddressInput = {
                id: addressId,
                streetLine1: '5 Test Street',
                countryCode: 'AT',
            };
            const result = await shopClient.query(updateAddressDocument, { input });

            expect(result.updateCustomerAddress.streetLine1).toEqual('5 Test Street');
            expect(result.updateCustomerAddress.country.code).toEqual('AT');
        });

        it('customer history for CUSTOMER_ADDRESS_UPDATED', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer.id,
                options: { skip: 5 },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_ADDRESS_UPDATED,
                    data: {
                        address: '5 Test Street, Austria',
                        input: {
                            id: addressId,
                            streetLine1: '5 Test Street',
                            countryCode: 'AT',
                        },
                    },
                },
            ]);
        });

        it(
            'updateCustomerAddress fails for address not owned by Customer',
            assertThrowsWithMessage(async () => {
                const input: UpdateAddressInput = {
                    id: 'T_2',
                    streetLine1: '1 Test Street',
                };
                await shopClient.query(updateAddressDocument, { input });
            }, 'You are not currently authorized to perform this action'),
        );

        it('deleteCustomerAddress works', async () => {
            const { deleteCustomerAddress } = await shopClient.query(deleteAddressDocument, { id: 'T_3' });

            expect(deleteCustomerAddress.success).toBe(true);
        });

        it('customer history for CUSTOMER_ADDRESS_DELETED', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer!.id,
                options: { skip: 6 },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_ADDRESS_DELETED,
                    data: {
                        address: '5 Test Street, Austria',
                    },
                },
            ]);
        });

        it(
            'deleteCustomerAddress fails for address not owned by Customer',
            assertThrowsWithMessage(async () => {
                await shopClient.query(deleteAddressDocument, { id: 'T_2' });
            }, 'You are not currently authorized to perform this action'),
        );

        it('updatePassword return error result with incorrect current password', async () => {
            const { updateCustomerPassword } = await shopClient.query(updatePasswordDocument, {
                old: 'wrong',
                new: 'test2',
            });
            successErrorGuard.assertErrorResult(updateCustomerPassword);

            if ('message' in updateCustomerPassword && 'errorCode' in updateCustomerPassword) {
                expect(updateCustomerPassword.message).toBe('The provided credentials are invalid');
                expect(updateCustomerPassword.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
            }
        });

        it('updatePassword works', async () => {
            const { updateCustomerPassword } = await shopClient.query(updatePasswordDocument, {
                old: 'test',
                new: 'test2',
            });
            successErrorGuard.assertSuccess(updateCustomerPassword);

            expect(updateCustomerPassword.success).toBe(true);

            // Log out and log in with new password
            const loginResult = await shopClient.asUserWithCredentials(customer.emailAddress, 'test2');
            expect(loginResult.identifier).toBe(customer.emailAddress);
        });

        it('customer history for CUSTOMER_PASSWORD_UPDATED', async () => {
            const result = await adminClient.query(getCustomerHistoryDocument, {
                id: customer.id,
                options: { skip: 7 },
            });

            expect(result.customer?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_PASSWORD_UPDATED,
                    data: {},
                },
            ]);
        });
    });
});
