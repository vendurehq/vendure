import { CreateCustomerInput, SetCustomerForOrderResult } from '@vendure/common/lib/generated-shop-types';
import {
    ChannelService,
    Customer,
    CustomerService,
    ErrorResultUnion,
    GuestCheckoutError,
    GuestCheckoutStrategy,
    Injector,
    Order,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import path from 'path';
import { IsNull } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { AlreadyLoggedInError } from '../src/common/error/generated-graphql-shop-errors';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { ResultOf } from './graphql/graphql-admin';
import { FragmentOf } from './graphql/graphql-shop';
import { getCustomerListDocument } from './graphql/shared-definitions';
import {
    activeOrderCustomerDocument,
    addItemToOrderDocument,
    getActiveOrderCustomerUserDocument,
    setCustomerDocument,
} from './graphql/shop-definitions';

class TestGuestCheckoutStrategy implements GuestCheckoutStrategy {
    static allowGuestCheckout = true;
    static allowGuestCheckoutForRegisteredCustomers = true;
    static createNewCustomerOnEmailAddressConflict = false;

    private customerService: CustomerService;
    private connection: TransactionalConnection;
    private channelService: ChannelService;

    init(injector: Injector) {
        this.customerService = injector.get(CustomerService);
        this.connection = injector.get(TransactionalConnection);
        this.channelService = injector.get(ChannelService);
    }

    async setCustomerForOrder(
        ctx: RequestContext,
        order: Order,
        input: CreateCustomerInput,
    ): Promise<ErrorResultUnion<SetCustomerForOrderResult, Customer>> {
        if (TestGuestCheckoutStrategy.allowGuestCheckout === false) {
            return new GuestCheckoutError({ errorDetail: 'Guest orders are disabled' });
        }
        if (ctx.activeUserId) {
            return new AlreadyLoggedInError();
        }
        if (TestGuestCheckoutStrategy.createNewCustomerOnEmailAddressConflict === true) {
            const existing = await this.connection.getRepository(ctx, Customer).findOne({
                relations: ['channels'],
                where: {
                    emailAddress: input.emailAddress,
                    deletedAt: IsNull(),
                },
            });
            if (existing) {
                const newCustomer = new Customer(input);
                await this.channelService.assignToCurrentChannel(newCustomer, ctx);
                return this.connection.getRepository(ctx, Customer).save(newCustomer);
            }
        }
        const errorOnExistingUser = !TestGuestCheckoutStrategy.allowGuestCheckoutForRegisteredCustomers;
        const customer = await this.customerService.createOrUpdate(ctx, input, errorOnExistingUser);
        return customer;
    }
}

describe('GuestCheckoutStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        orderOptions: {
            guestCheckoutStrategy: new TestGuestCheckoutStrategy(),
        },
        paymentOptions: {
            paymentMethodHandlers: [testSuccessfulPaymentMethod],
        },
    });
    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

    const orderResultGuard: ErrorResultGuard<FragmentOf<typeof activeOrderCustomerDocument>> =
        createErrorResultGuard(input => !!input.lines);

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(getCustomerListDocument);
        customers = result.customers.items;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('with guest checkout disabled', async () => {
        TestGuestCheckoutStrategy.allowGuestCheckout = false;

        await shopClient.asAnonymousUser();
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: 'guest@test.com',
                firstName: 'Guest',
                lastName: 'User',
            },
        });

        orderResultGuard.assertErrorResult(setCustomerForOrder);
        expect(setCustomerForOrder.errorCode).toBe('GUEST_CHECKOUT_ERROR');
        expect((setCustomerForOrder as any).errorDetail).toBe('Guest orders are disabled');
    });

    it('with guest checkout enabled', async () => {
        TestGuestCheckoutStrategy.allowGuestCheckout = true;

        await shopClient.asAnonymousUser();
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: 'guest@test.com',
                firstName: 'Guest',
                lastName: 'User',
            },
        });

        orderResultGuard.assertSuccess(setCustomerForOrder);
        expect(setCustomerForOrder.customer?.emailAddress).toBe('guest@test.com');
    });

    it('with guest checkout for registered customers disabled', async () => {
        TestGuestCheckoutStrategy.allowGuestCheckoutForRegisteredCustomers = false;

        await shopClient.asAnonymousUser();
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: customers[0].emailAddress,
                firstName: customers[0].firstName,
                lastName: customers[0].lastName,
            },
        });

        orderResultGuard.assertErrorResult(setCustomerForOrder);
        expect(setCustomerForOrder.errorCode).toBe('EMAIL_ADDRESS_CONFLICT_ERROR');
    });

    it('with guest checkout for registered customers enabled', async () => {
        TestGuestCheckoutStrategy.allowGuestCheckoutForRegisteredCustomers = true;

        await shopClient.asAnonymousUser();
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: customers[0].emailAddress,
                firstName: customers[0].firstName,
                lastName: customers[0].lastName,
            },
        });

        orderResultGuard.assertSuccess(setCustomerForOrder);
        expect(setCustomerForOrder.customer?.emailAddress).toBe(customers[0].emailAddress);
        expect(setCustomerForOrder.customer?.id).toBe(customers[0].id);
    });

    it('create new customer on email address conflict', async () => {
        TestGuestCheckoutStrategy.createNewCustomerOnEmailAddressConflict = true;

        await shopClient.asAnonymousUser();
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: customers[0].emailAddress,
                firstName: customers[0].firstName,
                lastName: customers[0].lastName,
            },
        });

        orderResultGuard.assertSuccess(setCustomerForOrder);
        expect(setCustomerForOrder.customer?.emailAddress).toBe(customers[0].emailAddress);
        expect(setCustomerForOrder.customer?.id).not.toBe(customers[0].id);
    });

    // https://github.com/vendurehq/vendure/issues/4026
    it('guest customer with same email as registered customer should not show as verified', async () => {
        TestGuestCheckoutStrategy.createNewCustomerOnEmailAddressConflict = true;

        await shopClient.asAnonymousUser();
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: customers[0].emailAddress,
                firstName: 'Guest',
                lastName: 'Shared Email',
            },
        });

        orderResultGuard.assertSuccess(setCustomerForOrder);
        expect(setCustomerForOrder.customer?.id).not.toBe(customers[0].id);

        const { activeOrder } = await shopClient.query(getActiveOrderCustomerUserDocument);
        expect(activeOrder?.customer?.id).toBe(setCustomerForOrder.customer?.id);
        expect(activeOrder?.customer?.user).toBeNull();
    });

    it('when already logged in', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        await addItemToOrder(shopClient);

        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: {
                emailAddress: customers[0].emailAddress,
                firstName: customers[0].firstName,
                lastName: customers[0].lastName,
            },
        });

        orderResultGuard.assertErrorResult(setCustomerForOrder);
        expect(setCustomerForOrder.errorCode).toBe('ALREADY_LOGGED_IN_ERROR');
    });
});

async function addItemToOrder(shopClient: SimpleGraphQLClient) {
    await shopClient.query(addItemToOrderDocument, {
        productVariantId: 'T_1',
        quantity: 1,
    });
}
