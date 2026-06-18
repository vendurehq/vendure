import { DeletionResult, ErrorCode, HistoryEntryType } from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import {
    AccountRegistrationEvent,
    ConfigService,
    EventBus,
    OrderService,
    RequestContextService,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { customerFragment } from './graphql/fragments-admin';
import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import { FragmentOf as FragmentOfShop } from './graphql/graphql-shop';
import {
    addNoteToCustomerDocument,
    createAddressDocument,
    createAdministratorDocument,
    createCustomerDocument,
    deleteCustomerAddressDocument,
    deleteCustomerDocument,
    deleteCustomerNoteDocument,
    getCustomerDocument,
    getCustomerHistoryDocument,
    getCustomerListDocument,
    getCustomerOrdersDocument,
    getCustomerWithUserDocument,
    MeDocument,
    updateAddressDocument,
    updateCustomerDocument,
    updateCustomerNoteDocument,
} from './graphql/shared-definitions';
import {
    activeOrderCustomerDocument,
    addItemToOrderDocument,
    setCustomerDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

type CustomerListItem = ResultOf<typeof getCustomerListDocument>['customers']['items'][number];
type CustomerFragment = FragmentOf<typeof customerFragment>;
type UpdatedOrderFragment = FragmentOfShop<typeof updatedOrderFragment>;
type ActiveOrderCustomerFragment = FragmentOfShop<typeof activeOrderCustomerDocument>;
type CustomerOrdersResult = NonNullable<ResultOf<typeof getCustomerOrdersDocument>['customer']>;
type CustomerHistoryResult = NonNullable<ResultOf<typeof getCustomerHistoryDocument>['customer']>;

const customerErrorGuard: ErrorResultGuard<CustomerFragment> = createErrorResultGuard(
    input => !!input.emailAddress,
);
const orderResultGuard: ErrorResultGuard<UpdatedOrderFragment> = createErrorResultGuard(
    input => 'lines' in input && !!input.lines,
);
const setCustomerForOrderGuard: ErrorResultGuard<ActiveOrderCustomerFragment> = createErrorResultGuard(
    input => 'lines' in input && !!input.lines,
);
const customerOrdersGuard: ErrorResultGuard<CustomerOrdersResult> = createErrorResultGuard(
    input => !!input.orders,
);
const customerHistoryGuard: ErrorResultGuard<CustomerHistoryResult> = createErrorResultGuard(
    input => !!input.history,
);
describe('Customer resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

    let firstCustomer: CustomerListItem;
    let secondCustomer: CustomerListItem;
    let thirdCustomer: CustomerListItem;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 5,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('customers list', async () => {
        const result = await adminClient.query(getCustomerListDocument);

        expect(result.customers.items.length).toBe(5);
        expect(result.customers.totalItems).toBe(5);
        firstCustomer = result.customers.items[0];
        secondCustomer = result.customers.items[1];
        thirdCustomer = result.customers.items[2];
    });

    it('customers list filter by postalCode', async () => {
        const result = await adminClient.query(getCustomerListDocument, {
            options: {
                filter: {
                    postalCode: {
                        eq: 'NU9 0PW',
                    },
                },
            },
        });

        expect(result.customers.items.length).toBe(1);
        expect(result.customers.items[0].emailAddress).toBe('eliezer56@yahoo.com');
    });

    it('customer resolver resolves User', async () => {
        const emailAddress = 'same-email@test.com';

        // Create an administrator with the same email first in order to ensure the right user is resolved.
        // This test also validates that a customer can be created with the same identifier
        // of an existing administrator
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress,
                firstName: 'First',
                lastName: 'Last',
                password: '123',
                roleIds: ['1'],
            },
        });

        expect(createAdministrator.emailAddress).toEqual(emailAddress);

        const { createCustomer } = await adminClient.query(createCustomerDocument, {
            input: {
                emailAddress,
                firstName: 'New',
                lastName: 'Customer',
            },
            password: 'test',
        });

        customerErrorGuard.assertSuccess(createCustomer);
        expect(createCustomer.emailAddress).toEqual(emailAddress);

        const { customer } = await adminClient.query(getCustomerWithUserDocument, {
            id: createCustomer.id,
        });

        expect(customer!.user).toEqual({
            id: createCustomer.user?.id,
            identifier: emailAddress,
            verified: true,
        });
    });

    describe('addresses', () => {
        let firstCustomerAddressIds: string[] = [];
        let firstCustomerThirdAddressId: string;

        it(
            'createCustomerAddress throws on invalid countryCode',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(createAddressDocument, {
                        id: firstCustomer.id,
                        input: {
                            streetLine1: 'streetLine1',
                            countryCode: 'INVALID',
                        },
                    }),
                'The countryCode "INVALID" was not recognized',
            ),
        );

        it('createCustomerAddress creates a new address', async () => {
            const result = await adminClient.query(createAddressDocument, {
                id: firstCustomer.id,
                input: {
                    fullName: 'fullName',
                    company: 'company',
                    streetLine1: 'streetLine1',
                    streetLine2: 'streetLine2',
                    city: 'city',
                    province: 'province',
                    postalCode: 'postalCode',
                    countryCode: 'GB',
                    phoneNumber: 'phoneNumber',
                    defaultShippingAddress: false,
                    defaultBillingAddress: false,
                },
            });
            expect(omit(result.createCustomerAddress, ['id'])).toEqual({
                fullName: 'fullName',
                company: 'company',
                streetLine1: 'streetLine1',
                streetLine2: 'streetLine2',
                city: 'city',
                province: 'province',
                postalCode: 'postalCode',
                country: {
                    code: 'GB',
                    name: 'United Kingdom',
                },
                phoneNumber: 'phoneNumber',
                defaultShippingAddress: false,
                defaultBillingAddress: false,
            });
        });

        it('customer query returns addresses', async () => {
            const result = await adminClient.query(getCustomerDocument, {
                id: firstCustomer.id,
            });

            expect(result.customer!.addresses!.length).toBe(2);
            firstCustomerAddressIds = result.customer!.addresses!.map(a => a.id).sort();
        });

        it('updateCustomerAddress updates the country', async () => {
            const result = await adminClient.query(updateAddressDocument, {
                input: {
                    id: firstCustomerAddressIds[0],
                    countryCode: 'AT',
                },
            });
            expect(result.updateCustomerAddress.country).toEqual({
                code: 'AT',
                name: 'Austria',
            });
        });

        it('updateCustomerAddress allows only a single default address', async () => {
            // set the first customer's second address to be default
            const result1 = await adminClient.query(updateAddressDocument, {
                input: {
                    id: firstCustomerAddressIds[1],
                    defaultShippingAddress: true,
                    defaultBillingAddress: true,
                },
            });
            expect(result1.updateCustomerAddress.defaultShippingAddress).toBe(true);
            expect(result1.updateCustomerAddress.defaultBillingAddress).toBe(true);

            // assert the first customer's other address is not default
            const result2 = await adminClient.query(getCustomerDocument, {
                id: firstCustomer.id,
            });
            const otherAddress = result2.customer!.addresses!.filter(
                a => a.id !== firstCustomerAddressIds[1],
            )[0]!;
            expect(otherAddress.defaultShippingAddress).toBe(false);
            expect(otherAddress.defaultBillingAddress).toBe(false);

            // set the first customer's first address to be default
            const result3 = await adminClient.query(updateAddressDocument, {
                input: {
                    id: firstCustomerAddressIds[0],
                    defaultShippingAddress: true,
                    defaultBillingAddress: true,
                },
            });
            expect(result3.updateCustomerAddress.defaultShippingAddress).toBe(true);
            expect(result3.updateCustomerAddress.defaultBillingAddress).toBe(true);

            // assert the first customer's second address is not default
            const result4 = await adminClient.query(getCustomerDocument, {
                id: firstCustomer.id,
            });
            const otherAddress2 = result4.customer!.addresses!.filter(
                a => a.id !== firstCustomerAddressIds[0],
            )[0]!;
            expect(otherAddress2.defaultShippingAddress).toBe(false);
            expect(otherAddress2.defaultBillingAddress).toBe(false);

            // get the second customer's address id
            const result5 = await adminClient.query(getCustomerDocument, {
                id: secondCustomer.id,
            });
            const secondCustomerAddressId = result5.customer!.addresses![0].id;

            // set the second customer's address to be default
            const result6 = await adminClient.query(updateAddressDocument, {
                input: {
                    id: secondCustomerAddressId,
                    defaultShippingAddress: true,
                    defaultBillingAddress: true,
                },
            });
            expect(result6.updateCustomerAddress.defaultShippingAddress).toBe(true);
            expect(result6.updateCustomerAddress.defaultBillingAddress).toBe(true);

            // assets the first customer's address defaults are unchanged
            const result7 = await adminClient.query(getCustomerDocument, {
                id: firstCustomer.id,
            });
            const firstCustomerFirstAddress = result7.customer!.addresses!.find(
                a => a.id === firstCustomerAddressIds[0],
            )!;
            const firstCustomerSecondAddress = result7.customer!.addresses!.find(
                a => a.id === firstCustomerAddressIds[1],
            )!;
            expect(firstCustomerFirstAddress.defaultShippingAddress).toBe(true);
            expect(firstCustomerFirstAddress.defaultBillingAddress).toBe(true);
            expect(firstCustomerSecondAddress.defaultShippingAddress).toBe(false);
            expect(firstCustomerSecondAddress.defaultBillingAddress).toBe(false);
        });

        it('createCustomerAddress with true defaults unsets existing defaults', async () => {
            const { createCustomerAddress } = await adminClient.query(createAddressDocument, {
                id: firstCustomer.id,
                input: {
                    streetLine1: 'new default streetline',
                    countryCode: 'GB',
                    defaultShippingAddress: true,
                    defaultBillingAddress: true,
                },
            });
            expect(omit(createCustomerAddress, ['id'])).toEqual({
                fullName: '',
                company: '',
                streetLine1: 'new default streetline',
                streetLine2: '',
                city: '',
                province: '',
                postalCode: '',
                country: {
                    code: 'GB',
                    name: 'United Kingdom',
                },
                phoneNumber: '',
                defaultShippingAddress: true,
                defaultBillingAddress: true,
            });

            const { customer } = await adminClient.query(getCustomerDocument, {
                id: firstCustomer.id,
            });
            for (const address of customer!.addresses!) {
                const shouldBeDefault = address.id === createCustomerAddress.id;
                expect(address.defaultShippingAddress).toEqual(shouldBeDefault);
                expect(address.defaultBillingAddress).toEqual(shouldBeDefault);
            }

            firstCustomerThirdAddressId = createCustomerAddress.id;
        });

        it('deleteCustomerAddress on default address resets defaults', async () => {
            const { deleteCustomerAddress } = await adminClient.query(deleteCustomerAddressDocument, {
                id: firstCustomerThirdAddressId,
            });

            expect(deleteCustomerAddress.success).toBe(true);

            const { customer } = await adminClient.query(getCustomerDocument, {
                id: firstCustomer.id,
            });
            expect(customer!.addresses!.length).toBe(2);
            const defaultAddress = customer!.addresses!.filter(
                a => a.defaultBillingAddress && a.defaultShippingAddress,
            );
            const otherAddress = customer!.addresses!.filter(
                a => !a.defaultBillingAddress && !a.defaultShippingAddress,
            );
            expect(defaultAddress.length).toBe(1);
            expect(otherAddress.length).toBe(1);
        });
    });

    describe('orders', () => {
        it("lists that user's orders", async () => {
            // log in as first customer
            await shopClient.asUserWithCredentials(firstCustomer.emailAddress, 'test');
            // add an item to the order to create an order
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);

            const { customer } = await adminClient.query(getCustomerOrdersDocument, {
                id: firstCustomer.id,
            });

            customerOrdersGuard.assertSuccess(customer);

            expect(customer.orders.totalItems).toBe(1);
            expect(customer.orders.items[0].id).toBe(addItemToOrder.id);
        });

        // #4560 — findByCustomerId silently stripped any relation path
        // containing `productVariant`, breaking service-layer callers and
        // forcing N+1 in GraphQL. Eager loading via this method does NOT
        // filter soft-deleted variants (matching the prior `findOne`
        // behaviour) — `deletedAt` on ProductVariant is a plain nullable
        // column rather than `@DeleteDateColumn`.
        it('findByCustomerId honors explicitly requested productVariant relations', async () => {
            const orderService = server.app.get(OrderService);
            const requestContextService = server.app.get(RequestContextService);
            const configService = server.app.get(ConfigService);
            const ctx = await requestContextService.create({ apiType: 'admin' });

            // The GraphQL layer encodes IDs via the configured entityIdStrategy
            // (TestingEntityIdStrategy prefixes with "T_"). Service-layer calls
            // expect the raw DB id, so we decode here.
            const customerId = configService.entityOptions.entityIdStrategy!.decodeId(firstCustomer.id);

            const result = await orderService.findByCustomerId(ctx, customerId, undefined, [
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ]);

            // The preceding test seeded exactly one order for firstCustomer.
            expect(result.items.length).toBe(1);
            const order = result.items[0];
            expect(order.lines.length).toBeGreaterThan(0);
            expect(order.lines[0].productVariant).toBeDefined();
            expect(order.lines[0].productVariant.id).toBeDefined();
            expect(order.lines[0].productVariant.product).toBeDefined();
        });
    });

    describe('creation', () => {
        it('triggers verification event if no password supplied', async () => {
            const sendEmailFn = vi.fn();
            let resolveFn: () => void;
            const subscription = server.app
                .get(EventBus)
                .ofType(AccountRegistrationEvent)
                .subscribe(event => {
                    sendEmailFn(event);
                    resolveFn?.();
                });
            const eventReceived = new Promise<void>(resolve => {
                resolveFn = resolve;
            });

            const { createCustomer } = await adminClient.query(createCustomerDocument, {
                input: {
                    emailAddress: 'test1@test.com',
                    firstName: 'New',
                    lastName: 'Customer',
                },
            });
            customerErrorGuard.assertSuccess(createCustomer);

            expect(createCustomer.user!.verified).toBe(false);

            // Wait for the event to be received before making assertions
            await eventReceived;

            expect(sendEmailFn).toHaveBeenCalledTimes(1);
            expect(sendEmailFn.mock.calls[0][0] instanceof AccountRegistrationEvent).toBe(true);
            expect(sendEmailFn.mock.calls[0][0].user.identifier).toBe('test1@test.com');

            subscription.unsubscribe();
        });

        it('creates a verified Customer', async () => {
            const sendEmailFn = vi.fn();
            let resolveFn: () => void;
            const subscription = server.app
                .get(EventBus)
                .ofType(AccountRegistrationEvent)
                .subscribe(event => {
                    sendEmailFn(event);
                    resolveFn?.();
                });
            const eventReceived = new Promise<void>(resolve => {
                resolveFn = resolve;
            });

            const { createCustomer } = await adminClient.query(createCustomerDocument, {
                input: {
                    emailAddress: 'test2@test.com',
                    firstName: 'New',
                    lastName: 'Customer',
                },
                password: 'test',
            });
            customerErrorGuard.assertSuccess(createCustomer);

            // Wait for the event to be received before making assertions
            await eventReceived;

            expect(createCustomer.user!.verified).toBe(true);
            expect(sendEmailFn).toHaveBeenCalledTimes(1);

            subscription.unsubscribe();
        });

        it('return error result when using an existing, non-deleted emailAddress', async () => {
            const { createCustomer } = await adminClient.query(createCustomerDocument, {
                input: {
                    emailAddress: 'test2@test.com',
                    firstName: 'New',
                    lastName: 'Customer',
                },
                password: 'test',
            });
            customerErrorGuard.assertErrorResult(createCustomer);

            expect(createCustomer.message).toBe('The email address is not available.');
            expect(createCustomer.errorCode).toBe(ErrorCode.EMAIL_ADDRESS_CONFLICT_ERROR);
        });

        it('normalizes email address on creation', async () => {
            const { createCustomer } = await adminClient.query(createCustomerDocument, {
                input: {
                    emailAddress: ' JoeSmith@test.com ',
                    firstName: 'Joe',
                    lastName: 'Smith',
                },
                password: 'test',
            });
            customerErrorGuard.assertSuccess(createCustomer);
            expect(createCustomer.emailAddress).toBe('joesmith@test.com');
        });
    });

    describe('update', () => {
        it('returns error result when emailAddress not available', async () => {
            const { updateCustomer } = await adminClient.query(updateCustomerDocument, {
                input: {
                    id: thirdCustomer.id,
                    emailAddress: firstCustomer.emailAddress,
                },
            });
            customerErrorGuard.assertErrorResult(updateCustomer);

            expect(updateCustomer.message).toBe('The email address is not available.');
            expect(updateCustomer.errorCode).toBe(ErrorCode.EMAIL_ADDRESS_CONFLICT_ERROR);
        });

        it('succeeds when emailAddress is available', async () => {
            const { updateCustomer } = await adminClient.query(updateCustomerDocument, {
                input: {
                    id: thirdCustomer.id,
                    emailAddress: 'unique-email@test.com',
                },
            });
            customerErrorGuard.assertSuccess(updateCustomer);

            expect(updateCustomer.emailAddress).toBe('unique-email@test.com');
        });

        // https://github.com/vendurehq/vendure/issues/1071
        it('updates the associated User email address', async () => {
            await shopClient.asUserWithCredentials('unique-email@test.com', 'test');
            const { me } = await shopClient.query(MeDocument);

            expect(me?.identifier).toBe('unique-email@test.com');
        });

        // https://github.com/vendurehq/vendure/issues/2449
        it('normalizes email address on update', async () => {
            const { updateCustomer } = await adminClient.query(updateCustomerDocument, {
                input: {
                    id: thirdCustomer.id,
                    emailAddress: ' Another-Address@test.com ',
                },
            });
            customerErrorGuard.assertSuccess(updateCustomer);

            expect(updateCustomer.emailAddress).toBe('another-address@test.com');

            await shopClient.asUserWithCredentials('another-address@test.com', 'test');
            const { me } = await shopClient.query(MeDocument);

            expect(me?.identifier).toBe('another-address@test.com');
        });
    });

    describe('deletion', () => {
        it('deletes a customer', async () => {
            const result = await adminClient.query(deleteCustomerDocument, { id: thirdCustomer.id });

            expect(result.deleteCustomer).toEqual({ result: DeletionResult.DELETED });
        });

        it('cannot get a deleted customer', async () => {
            const result = await adminClient.query(getCustomerDocument, {
                id: thirdCustomer.id,
            });

            expect(result.customer).toBe(null);
        });

        it('deleted customer omitted from list', async () => {
            const result = await adminClient.query(getCustomerListDocument);

            expect(result.customers.items.map(c => c.id).includes(thirdCustomer.id)).toBe(false);
        });

        it(
            'updateCustomer throws for deleted customer',
            assertThrowsWithMessage(
                () =>
                    adminClient.query(updateCustomerDocument, {
                        input: {
                            id: thirdCustomer.id,
                            firstName: 'updated',
                        },
                    }),
                'No Customer with the id "3" could be found',
            ),
        );

        it('new Customer can be created with same emailAddress as a deleted Customer', async () => {
            const { createCustomer } = await adminClient.query(createCustomerDocument, {
                input: {
                    emailAddress: thirdCustomer.emailAddress,
                    firstName: 'Reusing Email',
                    lastName: 'Customer',
                },
            });
            customerErrorGuard.assertSuccess(createCustomer);

            expect(createCustomer.emailAddress).toBe(thirdCustomer.emailAddress);
            expect(createCustomer.firstName).toBe('Reusing Email');
            expect(createCustomer.user?.identifier).toBe(thirdCustomer.emailAddress);
        });

        // https://github.com/vendurehq/vendure/issues/1960
        it('delete a guest Customer', async () => {
            const orderErrorGuard: ErrorResultGuard<ActiveOrderCustomerFragment> = createErrorResultGuard(
                input => !!input.lines,
            );

            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
                input: {
                    firstName: 'Guest',
                    lastName: 'Customer',
                    emailAddress: 'guest@test.com',
                },
            });

            orderErrorGuard.assertSuccess(setCustomerForOrder);

            const result = await adminClient.query(deleteCustomerDocument, {
                id: setCustomerForOrder.customer!.id,
            });

            expect(result.deleteCustomer).toEqual({ result: DeletionResult.DELETED });
        });
    });

    describe('customer notes', () => {
        let noteId: string;

        it('addNoteToCustomer', async () => {
            const { addNoteToCustomer } = await adminClient.query(addNoteToCustomerDocument, {
                input: {
                    id: firstCustomer.id,
                    isPublic: false,
                    note: 'Test note',
                },
            });

            const { customer } = await adminClient.query(getCustomerHistoryDocument, {
                id: firstCustomer.id,
                options: {
                    filter: {
                        type: {
                            eq: HistoryEntryType.CUSTOMER_NOTE,
                        },
                    },
                },
            });

            customerHistoryGuard.assertSuccess(customer);

            expect(customer.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_NOTE,
                    data: {
                        note: 'Test note',
                    },
                },
            ]);

            noteId = customer.history.items[0].id;
        });

        it('update note', async () => {
            const { updateCustomerNote } = await adminClient.query(updateCustomerNoteDocument, {
                input: {
                    noteId,
                    note: 'An updated note',
                },
            });

            expect(updateCustomerNote.data).toEqual({
                note: 'An updated note',
            });
        });

        it('delete note', async () => {
            const { customer: before } = await adminClient.query(getCustomerHistoryDocument, {
                id: firstCustomer.id,
            });
            const historyCount = before!.history.totalItems;

            const { deleteCustomerNote } = await adminClient.query(deleteCustomerNoteDocument, {
                id: noteId,
            });

            expect(deleteCustomerNote.result).toBe(DeletionResult.DELETED);

            const { customer: after } = await adminClient.query(getCustomerHistoryDocument, {
                id: firstCustomer.id,
            });
            expect(after?.history.totalItems).toBe(historyCount - 1);
        });
    });
});
