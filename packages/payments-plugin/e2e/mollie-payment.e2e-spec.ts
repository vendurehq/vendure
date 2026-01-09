/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OrderStatus } from '@mollie/api-client';
import {
    ChannelService,
    EventBus,
    LanguageCode,
    Logger,
    mergeConfig,
    OrderPlacedEvent,
    OrderService,
    RequestContext,
} from '@vendure/core';
import {
    settlePaymentDocument,
    updateProductVariantsDocument,
} from '@vendure/core/e2e/graphql/shared-definitions';
import {
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    SimpleGraphQLClient,
    TestServer,
} from '@vendure/testing';
import nock from 'nock';
import fetch from 'node-fetch';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { MolliePlugin } from '../src/mollie';
import { molliePaymentHandler } from '../src/mollie/mollie.handler';

import { mollieMockData } from './fixtures/mollie-mock-data';
import {
    createPaymentMethodDocument,
    getCustomerListDocument,
    getOrderPaymentsDocument,
} from './graphql/admin-definitions';
import { testOrderFragment } from './graphql/fragments-shop';
import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import {
    createMolliePaymentIntentDocument,
    getMolliePaymentMethodsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    adjustOrderLineDocument,
    applyCouponCodeDocument,
    getOrderByCodeDocument,
} from './graphql/shop-definitions';
import {
    addManualPayment,
    createFixedDiscountCoupon,
    createFreeShippingCoupon,
    refundOrderLine,
    setShipping,
    testPaymentEligibilityChecker,
} from './payment-helpers';

let shopClient: SimpleGraphQLClient;
let adminClient: SimpleGraphQLClient;
let server: TestServer;
let started = false;
let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];
let order: FragmentOf<typeof testOrderFragment>;
let serverPort: number;
const SURCHARGE_AMOUNT = -20000;

describe('Mollie payments', () => {
    beforeAll(async () => {
        const devConfig = mergeConfig(testConfig(), {
            plugins: [MolliePlugin.init({ vendureHost: mollieMockData.host })],
            paymentOptions: {
                paymentMethodEligibilityCheckers: [testPaymentEligibilityChecker],
            },
        });
        const env = createTestEnvironment(devConfig);
        serverPort = devConfig.apiOptions.port;
        shopClient = env.shopClient;
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        started = true;
        await adminClient.asSuperAdmin();
        ({
            customers: { items: customers },
        } = await adminClient.query(getCustomerListDocument, {
            options: {
                take: 2,
            },
        }));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    afterEach(() => {
        nock.cleanAll();
    });

    it('Should start successfully', () => {
        expect(started).toEqual(true);
        expect(customers).toHaveLength(2);
    });

    it('Should create a Mollie paymentMethod', async () => {
        const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: mollieMockData.methodCode,
                enabled: true,
                checker: {
                    code: testPaymentEligibilityChecker.code,
                    arguments: [],
                },
                handler: {
                    code: molliePaymentHandler.code,
                    arguments: [
                        { name: 'redirectUrl', value: mollieMockData.redirectUrl },
                        { name: 'apiKey', value: mollieMockData.apiKey },
                    ],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Mollie payment test',
                        description: 'This is a Mollie test payment method',
                    },
                ],
            },
        });
        expect(createPaymentMethod.code).toBe(mollieMockData.methodCode);
    });

    describe('Payment intent creation', () => {
        it('Should prepare an order', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_5',
                quantity: 10,
            });
            order = addItemToOrder as FragmentOf<typeof testOrderFragment>;
            // Add surcharge
            const ctx = new RequestContext({
                apiType: 'admin',
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
                channel: await server.app.get(ChannelService).getDefaultChannel(),
            });
            await server.app.get(OrderService).addSurchargeToOrder(ctx, order.id.replace('T_', ''), {
                description: 'Negative test surcharge',
                listPrice: SURCHARGE_AMOUNT,
            });
            expect(order.code).toBeDefined();
        });

        it('Should fail to create payment intent without shippingmethod', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            const { createMolliePaymentIntent: result } = await shopClient.query(
                createMolliePaymentIntentDocument,
                {
                    input: {
                        paymentMethodCode: mollieMockData.methodCode,
                    },
                },
            );
            expect(result.errorCode).toBe('ORDER_PAYMENT_STATE_ERROR');
        });

        it('Should fail to get payment url when items are out of stock', async () => {
            let { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: {
                    id: 'T_5',
                    trackInventory: 'TRUE',
                    outOfStockThreshold: 0,
                    stockOnHand: 1,
                },
            });
            expect(updateProductVariants[0].stockOnHand).toBe(1);
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            await setShipping(shopClient);
            const { createMolliePaymentIntent: result } = await shopClient.query(
                createMolliePaymentIntentDocument,
                {
                    input: {
                        paymentMethodCode: mollieMockData.methodCode,
                    },
                },
            );
            expect(result.message).toContain('insufficient stock of Pinelab stickers');
            // Set stock back to not tracking
            ({ updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: {
                    id: 'T_5',
                    trackInventory: 'FALSE',
                },
            }));
            expect(updateProductVariants[0].trackInventory).toBe('FALSE');
        });

        it('Should get payment url without Mollie method', async () => {
            let mollieRequest: any | undefined;
            nock('https://api.mollie.com/')
                .post('/v2/payments', body => {
                    mollieRequest = body;
                    return true;
                })
                .reply(200, mollieMockData.molliePaymentResponse);
            const { createMolliePaymentIntent } = await shopClient.query(createMolliePaymentIntentDocument, {
                input: {
                    paymentMethodCode: mollieMockData.methodCode,
                    redirectUrl: 'given-storefront-redirect-url',
                    locale: 'nl_NL',
                },
            });
            expect(createMolliePaymentIntent).toEqual({
                url: 'https://www.mollie.com/checkout/select-method/mock-payment',
            });
            expect(mollieRequest?.description).toEqual(order.code);
            expect(mollieRequest?.redirectUrl).toEqual('given-storefront-redirect-url');
            expect(mollieRequest?.locale).toEqual('nl_NL');
            expect(mollieRequest?.captureMode).toEqual('automatic'); // Default should be automatic
            expect(mollieRequest?.webhookUrl).toEqual(
                `${mollieMockData.host}/payments/mollie/${E2E_DEFAULT_CHANNEL_TOKEN}/1`,
            );
            expect(mollieRequest?.amount?.value).toBe('1009.88');
            expect(mollieRequest?.amount?.currency).toBe('USD');
            expect(mollieRequest.lines[0].vatAmount.value).toEqual('199.98');
            const totalLineAmount =
                mollieRequest?.lines?.reduce(
                    (sum: number, line: any) => sum + Number(line.totalAmount.value),
                    0,
                ) ?? 0;
            // Sum of lines should equal order total
            expect(mollieRequest.amount.value).toEqual(totalLineAmount.toFixed(2));
        });

        it('Should use fallback redirect appended with order code, when no redirect is given', async () => {
            let mollieRequest: any | undefined;
            nock('https://api.mollie.com/')
                .post('/v2/payments', body => {
                    mollieRequest = body;
                    return true;
                })
                .reply(200, mollieMockData.molliePaymentResponse);
            await shopClient.query(createMolliePaymentIntentDocument, {
                input: {
                    paymentMethodCode: mollieMockData.methodCode,
                },
            });
            expect(mollieRequest?.redirectUrl).toEqual(`${mollieMockData.redirectUrl}/${order.code}`);
        });

        it('Should get payment url with Mollie method', async () => {
            nock('https://api.mollie.com/')
                .post('/v2/payments')
                .reply(200, mollieMockData.molliePaymentResponse);
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            await setShipping(shopClient);
            const { createMolliePaymentIntent } = await shopClient.query(createMolliePaymentIntentDocument, {
                input: {
                    paymentMethodCode: mollieMockData.methodCode,
                    molliePaymentMethodCode: 'ideal',
                },
            });
            expect(createMolliePaymentIntent).toEqual({
                url: 'https://www.mollie.com/checkout/select-method/mock-payment',
            });
        });

        it('Should not allow creating intent if payment method is not eligible', async () => {
            // Set quantity to 9, which is not allowe by our test eligibility checker
            await shopClient.query(adjustOrderLineDocument, {
                orderLineId: order.lines[0].id,
                quantity: 9,
            });
            let mollieRequest: any | undefined;
            nock('https://api.mollie.com/')
                .post('/v2/payments', body => {
                    mollieRequest = body;
                    return true;
                })
                .reply(200, mollieMockData.molliePaymentResponse);
            const { createMolliePaymentIntent } = await shopClient.query(createMolliePaymentIntentDocument, {
                input: {
                    paymentMethodCode: mollieMockData.methodCode,
                    redirectUrl: 'given-storefront-redirect-url',
                },
            });
            expect(createMolliePaymentIntent.errorCode).toBe('INELIGIBLE_PAYMENT_METHOD_ERROR');
            expect(createMolliePaymentIntent.message).toContain('is not eligible for order');
        });

        it('Should get payment url with deducted amount if a payment is already made', async () => {
            // Change quantity back to 10
            await shopClient.query(adjustOrderLineDocument, {
                orderLineId: order.lines[0].id,
                quantity: 10,
            });
            let mollieRequest: any | undefined;
            nock('https://api.mollie.com/')
                .post('/v2/payments', body => {
                    mollieRequest = body;
                    return true;
                })
                .reply(200, mollieMockData.molliePaymentResponse);
            await addManualPayment(server, 1, 10000);
            await shopClient.query(createMolliePaymentIntentDocument, {
                input: {
                    paymentMethodCode: mollieMockData.methodCode,
                },
            });
            expect(mollieRequest?.amount?.value).toBe('909.88'); // minus 100,00 from manual payment
            const totalLineAmount =
                mollieRequest?.lines?.reduce(
                    (sum: number, line: any) => sum + Number(line.totalAmount.value),
                    0,
                ) ?? 0;
            // This is the line that deducts the amount from payment that was already made
            const priceDeductionLine = mollieRequest.lines?.find((line: any) => line.totalAmount.value < 0);
            expect(priceDeductionLine?.type).toBe('store_credit');
            // Sum of lines should equal order total
            expect(mollieRequest.amount.value).toEqual(totalLineAmount.toFixed(2));
        });

        it('Should create intent as admin', async () => {
            nock('https://api.mollie.com/')
                .post('/v2/payments')
                .reply(200, mollieMockData.molliePaymentResponse);
            // Admin API passes order ID, and no payment method code
            const { createMolliePaymentIntent: intent } = await adminClient.query(
                createMolliePaymentIntentDocument,
                {
                    input: {
                        orderId: '1',
                    },
                },
            );
            expect(intent.url).toBe(mollieMockData.molliePaymentResponse._links.checkout.href);
        });

        it('Should get available paymentMethods', async () => {
            nock('https://api.mollie.com/')
                .get('/v2/methods?resource=orders')
                .reply(200, mollieMockData.molliePaymentMethodsResponse);
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            const { molliePaymentMethods } = await shopClient.query(getMolliePaymentMethodsDocument, {
                input: {
                    paymentMethodCode: mollieMockData.methodCode,
                },
            });
            const method = molliePaymentMethods[0];
            expect(method.code).toEqual('ideal');
            expect(method.minimumAmount).toBeDefined();
            expect(method.maximumAmount).toBeDefined();
            expect(method.image).toBeDefined();
        });

        it('Transitions to PaymentSettled for orders with a total of $0', async () => {
            await shopClient.asUserWithCredentials(customers[1].emailAddress, 'test');
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await setShipping(shopClient);
            // Discount the order so it has a total of $0
            await createFixedDiscountCoupon(adminClient, 156880, 'DISCOUNT_ORDER');
            await createFreeShippingCoupon(adminClient, 'FREE_SHIPPING');
            await shopClient.query(applyCouponCodeDocument, { couponCode: 'DISCOUNT_ORDER' });
            await shopClient.query(applyCouponCodeDocument, { couponCode: 'FREE_SHIPPING' });
            // Create payment intent
            const { createMolliePaymentIntent: intent } = await shopClient.query(
                createMolliePaymentIntentDocument,
                {
                    input: {
                        paymentMethodCode: mollieMockData.methodCode,
                        redirectUrl: 'https://my-storefront.io/order-confirmation',
                    },
                },
            );
            const { orderByCode } = await shopClient.query(getOrderByCodeDocument, {
                code: addItemToOrder.code,
            });
            expect(intent.url).toBe('https://my-storefront.io/order-confirmation');
            expect(orderByCode.totalWithTax).toBe(0);
            expect(orderByCode.state).toBe('PaymentSettled');
        });
    });

    describe('Handle standard payment methods', () => {
        it('Should transition to ArrangingPayment when partially paid', async () => {
            nock('https://api.mollie.com/')
                .get(`/v2/payments/${mollieMockData.molliePaymentResponse.id}`)
                .reply(200, {
                    ...mollieMockData.molliePaymentResponse,
                    // Mollie says: Only 20.00 was paid
                    amount: { value: '20.00', currency: 'EUR' },
                    description: order.code,
                    status: OrderStatus.paid,
                });
            await fetch(`http://localhost:${serverPort}/payments/mollie/${E2E_DEFAULT_CHANNEL_TOKEN}/1`, {
                method: 'post',
                body: JSON.stringify({ id: mollieMockData.molliePaymentResponse.id }),
                headers: { 'Content-Type': 'application/json' },
            });
            const { order: adminOrder } = await adminClient.query(getOrderPaymentsDocument, {
                id: order?.id,
            });
            expect(adminOrder.state).toBe('ArrangingPayment');
        });

        let orderPlacedEvent: OrderPlacedEvent | undefined;

        it('Should place order after paying outstanding amount', async () => {
            server.app
                .get(EventBus)
                .ofType(OrderPlacedEvent)
                .subscribe(event => {
                    orderPlacedEvent = event;
                });
            nock('https://api.mollie.com/')
                .get(`/v2/payments/${mollieMockData.molliePaymentResponse.id}`)
                .reply(200, {
                    ...mollieMockData.molliePaymentResponse,
                    // Add a payment of remaining 1089.90
                    amount: { value: '1089.90', currency: 'EUR' }, // 1109.90 minus the previously paid 20.00 = 1089.90
                    description: order.code,
                    status: OrderStatus.paid,
                });
            await fetch(`http://localhost:${serverPort}/payments/mollie/${E2E_DEFAULT_CHANNEL_TOKEN}/1`, {
                method: 'post',
                body: JSON.stringify({ id: mollieMockData.molliePaymentResponse.id }),
                headers: { 'Content-Type': 'application/json' },
            });
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            const { orderByCode } = await shopClient.query(getOrderByCodeDocument, {
                code: order.code,
            });
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            order = orderByCode!;
            expect(order.state).toBe('PaymentSettled');
        });

        it('Should log error when order is paid again with a another payment', async () => {
            const errorLogSpy = vi.spyOn(Logger, 'error');
            nock('https://api.mollie.com/')
                .get(`/v2/payments/tr_newMockId`)
                .reply(200, {
                    ...mollieMockData.molliePaymentResponse,
                    id: 'tr_newMockId',
                    amount: { value: '100', currency: 'EUR' }, // Try to pay another 100
                    description: order.code,
                    status: OrderStatus.paid,
                });
            await fetch(`http://localhost:${serverPort}/payments/mollie/${E2E_DEFAULT_CHANNEL_TOKEN}/1`, {
                method: 'post',
                body: JSON.stringify({ id: 'tr_newMockId' }),
                headers: { 'Content-Type': 'application/json' },
            });
            const logMessage = errorLogSpy.mock.calls?.[0]?.[0];
            expect(logMessage).toBe(
                `Order '${order.code}' is already paid. Mollie payment 'tr_newMockId' should be refunded.`,
            );
        });

        it('Should have preserved original languageCode ', () => {
            // We've set the languageCode to 'nl' in the mock response's metadata
            expect(orderPlacedEvent?.ctx.languageCode).toBe('nl');
        });

        it('Resulting events should have a ctx.req ', () => {
            // We've set the languageCode to 'nl' in the mock response's metadata
            expect(orderPlacedEvent?.ctx?.req).toBeDefined();
        });

        it('Should have Mollie metadata on payment', async () => {
            const {
                order: { payments },
            } = await adminClient.query(getOrderPaymentsDocument, { id: order.id });
            const metadata = payments[1].metadata;
            expect(metadata.mode).toBe(mollieMockData.molliePaymentResponse.mode);
            expect(metadata.profileId).toBe(mollieMockData.molliePaymentResponse.profileId);
            expect(metadata.authorizedAt).toEqual(mollieMockData.molliePaymentResponse.authorizedAt);
            expect(metadata.paidAt).toEqual(mollieMockData.molliePaymentResponse.paidAt);
        });

        it('Should fail to refund', async () => {
            nock('https://api.mollie.com/')
                .get(`/v2/payments/${mollieMockData.molliePaymentResponse.id}`)
                .reply(200, mollieMockData.molliePaymentResponse);
            nock('https://api.mollie.com/')
                .post('/v2/payments/tr_mockPayment/refunds')
                .reply(200, { status: 'failed', resource: 'payment' });
            const refund = await refundOrderLine(
                adminClient,
                order.lines[0].id,
                1,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                order!.payments![1].id,
                SURCHARGE_AMOUNT,
            );
            expect(refund.state).toBe('Failed');
        });

        it('Should successfully refund the Mollie payment', async () => {
            let mollieRequest: any;
            nock('https://api.mollie.com/')
                .get(`/v2/payments/${mollieMockData.molliePaymentResponse.id}`)
                .reply(200, mollieMockData.molliePaymentResponse);
            nock('https://api.mollie.com/')
                .post('/v2/payments/tr_mockPayment/refunds', body => {
                    mollieRequest = body;
                    return true;
                })
                .reply(200, { status: 'pending', resource: 'payment' });
            const refund = await refundOrderLine(
                adminClient,
                order.lines[0].id,
                10,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                order.payments!.find(p => p.amount === 108990)!.id,
                SURCHARGE_AMOUNT,
            );
            expect(mollieRequest?.amount.value).toBe('999.90'); // Only refund mollie amount, not the gift card
            expect(refund.total).toBe(99990);
            expect(refund.state).toBe('Settled');
        });
    });

    describe('Handle pay-later with manual capture', () => {
        it('Should prepare a new order', async () => {
            await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            order = addItemToOrder as FragmentOf<typeof testOrderFragment>;
            await setShipping(shopClient);
            expect(order.code).toBeDefined();
        });

        it('Should create payment intent with immediateCapture = false', async () => {
            let mollieRequest: any;
            nock('https://api.mollie.com/')
                .post('/v2/payments', body => {
                    mollieRequest = body;
                    return true;
                })
                .reply(200, mollieMockData.molliePaymentResponse);
            await shopClient.query(createMolliePaymentIntentDocument, {
                input: {
                    immediateCapture: false,
                },
            });
            expect(mollieRequest.captureMode).toBe('manual');
        });

        it('Should authorize payment with immediateCapture = false', async () => {
            nock('https://api.mollie.com/')
                .get(`/v2/payments/${mollieMockData.molliePaymentResponse.id}`)
                .reply(200, {
                    ...mollieMockData.molliePaymentResponse,
                    amount: { value: '3127.60', currency: 'EUR' },
                    description: order.code,
                    status: OrderStatus.authorized,
                });
            await fetch(`http://localhost:${serverPort}/payments/mollie/${E2E_DEFAULT_CHANNEL_TOKEN}/1`, {
                method: 'post',
                body: JSON.stringify({ id: mollieMockData.molliePaymentResponse.id }),
                headers: { 'Content-Type': 'application/json' },
            });
            const { orderByCode } = await shopClient.query(getOrderByCodeDocument, {
                code: order.code,
            });
            order = orderByCode!;
            expect(order.state).toBe('PaymentAuthorized');
        });

        it('Should settle payment via settlePayment mutation', async () => {
            // Mock the getOrder Mollie call
            nock('https://api.mollie.com/')
                .get(`/v2/payments/${mollieMockData.molliePaymentResponse.id}`)
                .reply(200, {
                    ...mollieMockData.molliePaymentResponse,
                    description: order.code,
                    status: OrderStatus.authorized,
                    amount: { value: '3127.60', currency: 'EUR' },
                });
            // Mock the createCapture call
            let createCaptureRequest: any;
            nock('https://api.mollie.com/')
                .post(`/v2/payments/tr_mockPayment/captures`, body => {
                    createCaptureRequest = body;
                    return true;
                })
                .reply(200, { status: 'pending', id: 'cpt_mockCapture', resource: 'capture' });
            // Mock the getCapture call
            nock('https://api.mollie.com/')
                .get(`/v2/payments/tr_mockPayment/captures/cpt_mockCapture`)
                .reply(200, { status: 'succeeded', id: 'cpt_mockCapture', resource: 'capture' });
            await adminClient.query(settlePaymentDocument, {
                id: order.payments![0].id,
            });
            const { orderByCode } = await shopClient.query(getOrderByCodeDocument, {
                code: order.code,
            });
            order = orderByCode!;
            expect(createCaptureRequest.amount.value).toBe('3127.60'); // Full amount
            expect(order.state).toBe('PaymentSettled');
        });
    });
});
