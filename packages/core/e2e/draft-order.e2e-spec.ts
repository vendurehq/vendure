/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    DefaultOrderPlacedStrategy,
    mergeConfig,
    Order,
    orderPercentageDiscount,
    OrderState,
    RequestContext,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { singleStageRefundablePaymentMethod } from './fixtures/test-payment-methods';
import {
    canceledOrderFragment,
    orderFragment,
    orderWithLinesFragment,
    paymentFragment,
} from './graphql/fragments-admin';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';
import {
    addManualPaymentDocument,
    adminTransitionToStateDocument,
    createPromotionDocument,
    getCustomerListDocument,
} from './graphql/shared-definitions';
import { getActiveCustomerOrdersDocument } from './graphql/shop-definitions';

class TestOrderPlacedStrategy extends DefaultOrderPlacedStrategy {
    static spy = vi.fn();
    shouldSetAsPlaced(
        ctx: RequestContext,
        fromState: OrderState,
        toState: OrderState,
        order: Order,
    ): boolean {
        TestOrderPlacedStrategy.spy(order);
        return super.shouldSetAsPlaced(ctx, fromState, toState, order);
    }
}

describe('Draft Orders resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [singleStageRefundablePaymentMethod],
            },
            orderOptions: {
                orderPlacedStrategy: new TestOrderPlacedStrategy(),
            },
            dbConnectionOptions: {
                logging: true,
            },
        }),
    );
    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];
    let draftOrder: FragmentOf<typeof orderWithLinesFragment>;
    const freeOrderCouponCode = 'FREE';

    const orderGuard: ErrorResultGuard<
        | FragmentOf<typeof orderWithLinesFragment>
        | FragmentOf<typeof canceledOrderFragment>
        | FragmentOf<typeof orderFragment>
    > = createErrorResultGuard(input => ('lines' in input && !!input.lines) || !!input.state);

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: singleStageRefundablePaymentMethod.code,
                        handler: { code: singleStageRefundablePaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();

        // Create a couple of orders to be queried
        const result = await adminClient.query(getCustomerListDocument, {
            options: {
                take: 3,
            },
        });
        customers = result.customers.items;

        // Create a coupon code promotion
        await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                conditions: [],
                couponCode: freeOrderCouponCode,
                actions: [
                    {
                        code: orderPercentageDiscount.code,
                        arguments: [{ name: 'discount', value: '100' }],
                    },
                ],
                translations: [{ languageCode: LanguageCode.en, name: 'Free Order' }],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('create draft order', async () => {
        const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);

        expect(createDraftOrder.state).toBe('Draft');
        expect(createDraftOrder.active).toBe(false);
        draftOrder = createDraftOrder;
    });

    it('addItemToDraftOrder', async () => {
        const { addItemToDraftOrder } = await adminClient.query(addItemToDraftOrderDocument, {
            orderId: draftOrder.id,
            input: {
                productVariantId: 'T_5',
                quantity: 2,
            },
        });

        orderGuard.assertSuccess(addItemToDraftOrder);

        expect(addItemToDraftOrder.lines.length).toBe(1);
        draftOrder = addItemToDraftOrder;
    });

    it('adjustDraftOrderLine up', async () => {
        const firstLine = draftOrder.lines[0];
        if (!firstLine) throw new Error('Expected first line to exist');
        const { adjustDraftOrderLine } = await adminClient.query(adjustDraftOrderLineDocument, {
            orderId: draftOrder.id,
            input: {
                orderLineId: firstLine.id,
                quantity: 5,
            },
        });

        orderGuard.assertSuccess(adjustDraftOrderLine);
        expect(adjustDraftOrderLine.lines[0].quantity).toBe(5);
    });

    it('adjustDraftOrderLine down', async () => {
        const firstLine = draftOrder.lines[0];
        if (!firstLine) throw new Error('Expected first line to exist');
        const { adjustDraftOrderLine } = await adminClient.query(adjustDraftOrderLineDocument, {
            orderId: draftOrder.id,
            input: {
                orderLineId: firstLine.id,
                quantity: 2,
            },
        });

        orderGuard.assertSuccess(adjustDraftOrderLine);
        expect(adjustDraftOrderLine.lines[0].quantity).toBe(2);
    });

    it('removeDraftOrderLine', async () => {
        const firstLine = draftOrder.lines[0];
        if (!firstLine) throw new Error('Expected first line to exist');
        const { removeDraftOrderLine } = await adminClient.query(removeDraftOrderLineDocument, {
            orderId: draftOrder.id,
            orderLineId: firstLine.id,
        });

        orderGuard.assertSuccess(removeDraftOrderLine);
        expect(removeDraftOrderLine.lines.length).toBe(0);
    });

    it('setCustomerForDraftOrder', async () => {
        const { setCustomerForDraftOrder } = await adminClient.query(setCustomerForDraftOrderDocument, {
            orderId: draftOrder.id,
            customerId: customers[0].id,
        });

        orderGuard.assertSuccess(setCustomerForDraftOrder);
        expect(setCustomerForDraftOrder.customer?.id).toBe(customers[0].id);
    });

    it('custom does not see draft orders in history', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');

        const { activeCustomer } = await shopClient.query(getActiveCustomerOrdersDocument);

        expect(activeCustomer?.orders.totalItems).toBe(0);
        expect(activeCustomer?.orders.items.length).toBe(0);
    });

    it('setDraftOrderShippingAddress', async () => {
        const { setDraftOrderShippingAddress } = await adminClient.query(
            setShippingAddressForDraftOrderDocument,
            {
                orderId: draftOrder.id,
                input: {
                    streetLine1: 'Shipping Street',
                    city: 'Wigan',
                    province: 'Greater Manchester',
                    postalCode: 'WN1 2DD',
                    countryCode: 'GB',
                },
            },
        );

        expect(setDraftOrderShippingAddress.shippingAddress).toEqual({
            company: null,
            fullName: null,
            phoneNumber: null,
            streetLine2: null,
            province: 'Greater Manchester',
            city: 'Wigan',
            country: 'United Kingdom',
            postalCode: 'WN1 2DD',
            streetLine1: 'Shipping Street',
        });
    });

    it('setDraftOrderBillingAddress', async () => {
        const { setDraftOrderBillingAddress } = await adminClient.query(
            setBillingAddressForDraftOrderDocument,
            {
                orderId: draftOrder.id,
                input: {
                    streetLine1: 'Billing Street',
                    city: 'Skelmerdale',
                    province: 'Lancashire',
                    postalCode: 'WN8 3QW',
                    countryCode: 'GB',
                },
            },
        );

        expect(setDraftOrderBillingAddress.billingAddress).toEqual({
            company: null,
            fullName: null,
            phoneNumber: null,
            streetLine2: null,
            province: 'Lancashire',
            city: 'Skelmerdale',
            country: 'United Kingdom',
            postalCode: 'WN8 3QW',
            streetLine1: 'Billing Street',
        });
    });

    it('unsetDraftOrderShippingAddress', async () => {
        const { unsetDraftOrderShippingAddress } = await adminClient.query(
            unsetShippingAddressForDraftOrderDocument,
            {
                orderId: draftOrder.id,
            },
        );

        expect(unsetDraftOrderShippingAddress.shippingAddress).toEqual({
            company: null,
            fullName: null,
            phoneNumber: null,
            streetLine2: null,
            province: null,
            city: null,
            country: null,
            postalCode: null,
            streetLine1: null,
        });
    });

    it('unsetDraftOrderBillingAddress', async () => {
        const { unsetDraftOrderBillingAddress } = await adminClient.query(
            unsetBillingAddressForDraftOrderDocument,
            {
                orderId: draftOrder.id,
            },
        );

        expect(unsetDraftOrderBillingAddress.billingAddress).toEqual({
            company: null,
            fullName: null,
            phoneNumber: null,
            streetLine2: null,
            province: null,
            city: null,
            country: null,
            postalCode: null,
            streetLine1: null,
        });
    });

    it('applyCouponCodeToDraftOrder', async () => {
        const { addItemToDraftOrder } = await adminClient.query(addItemToDraftOrderDocument, {
            orderId: draftOrder.id,
            input: {
                productVariantId: 'T_1',
                quantity: 1,
            },
        });

        orderGuard.assertSuccess(addItemToDraftOrder);
        expect(addItemToDraftOrder.totalWithTax).toBe(155880);

        const { applyCouponCodeToDraftOrder } = await adminClient.query(applyCouponCodeToDraftOrderDocument, {
            orderId: draftOrder.id,
            couponCode: freeOrderCouponCode,
        });

        orderGuard.assertSuccess(applyCouponCodeToDraftOrder);

        expect(applyCouponCodeToDraftOrder.couponCodes).toEqual([freeOrderCouponCode]);
        expect(applyCouponCodeToDraftOrder.totalWithTax).toBe(0);
    });

    it('removeCouponCodeFromDraftOrder', async () => {
        const { removeCouponCodeFromDraftOrder } = await adminClient.query(
            removeCouponCodeFromDraftOrderDocument,
            {
                orderId: draftOrder.id,
                couponCode: freeOrderCouponCode,
            },
        );

        if (!removeCouponCodeFromDraftOrder) throw new Error('Expected order to be returned');
        expect(removeCouponCodeFromDraftOrder.couponCodes).toEqual([]);
        expect(removeCouponCodeFromDraftOrder.totalWithTax).toBe(155880);
    });

    it('eligibleShippingMethodsForDraftOrder', async () => {
        const { eligibleShippingMethodsForDraftOrder } = await adminClient.query(
            draftOrderEligibleShippingMethodsDocument,
            {
                orderId: draftOrder.id,
            },
        );

        expect(eligibleShippingMethodsForDraftOrder).toEqual([
            {
                code: 'standard-shipping',
                description: '',
                id: 'T_1',
                metadata: null,
                name: 'Standard Shipping',
                price: 500,
                priceWithTax: 500,
            },
            {
                code: 'express-shipping',
                description: '',
                id: 'T_2',
                metadata: null,
                name: 'Express Shipping',
                price: 1000,
                priceWithTax: 1000,
            },
            {
                code: 'express-shipping-taxed',
                description: '',
                id: 'T_3',
                metadata: null,
                name: 'Express Shipping (Taxed)',
                price: 1000,
                priceWithTax: 1200,
            },
        ]);
    });

    it('setDraftOrderShippingMethod', async () => {
        const { setDraftOrderShippingMethod } = await adminClient.query(setDraftOrderShippingMethodDocument, {
            orderId: draftOrder.id,
            shippingMethodId: 'T_2',
        });

        orderGuard.assertSuccess(setDraftOrderShippingMethod);

        expect(setDraftOrderShippingMethod.shippingWithTax).toBe(1000);
        expect(setDraftOrderShippingMethod.shippingLines.length).toBe(1);
        expect(setDraftOrderShippingMethod.shippingLines[0].shippingMethod.id).toBe('T_2');
    });

    // https://github.com/vendurehq/vendure/issues/2105
    it('sets order as placed when payment is settled', async () => {
        TestOrderPlacedStrategy.spy.mockClear();
        expect(TestOrderPlacedStrategy.spy.mock.calls.length).toBe(0);

        const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
            id: draftOrder.id,
            state: 'ArrangingPayment',
        });

        if (!transitionOrderToState) throw new Error('Expected transitionOrderToState result');
        orderGuard.assertSuccess(transitionOrderToState);
        expect(transitionOrderToState.state).toBe('ArrangingPayment');

        const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentDocument, {
            input: {
                orderId: draftOrder.id,
                metadata: {},
                method: singleStageRefundablePaymentMethod.code,
                transactionId: '12345',
            },
        });

        orderGuard.assertSuccess(addManualPaymentToOrder);
        expect(addManualPaymentToOrder.state).toBe('PaymentSettled');

        const { order } = await adminClient.query(getOrderPlacedAtDocument, {
            id: draftOrder.id,
        });
        expect(order?.orderPlacedAt).not.toBeNull();
        expect(TestOrderPlacedStrategy.spy.mock.calls.length).toBe(1);
        expect(TestOrderPlacedStrategy.spy.mock.calls[0][0].code).toBe(draftOrder.code);
    });
});

// Local fragment without countryCode to match original test expectations
const draftOrderShippingAddressFragment = graphql(`
    fragment DraftOrderShippingAddress on OrderAddress {
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        country
        phoneNumber
    }
`);

// Local orderWithLines fragment using the address fragment without countryCode
const draftOrderWithLinesFragment = graphql(
    `
        fragment DraftOrderWithLines on Order {
            id
            createdAt
            updatedAt
            code
            state
            active
            customer {
                id
                firstName
                lastName
            }
            lines {
                id
                featuredAsset {
                    preview
                }
                productVariant {
                    id
                    name
                    sku
                }
                taxLines {
                    description
                    taxRate
                }
                unitPrice
                unitPriceWithTax
                quantity
                taxRate
                linePriceWithTax
            }
            surcharges {
                id
                description
                sku
                price
                priceWithTax
            }
            subTotal
            subTotalWithTax
            total
            totalWithTax
            totalQuantity
            currencyCode
            shipping
            shippingWithTax
            shippingLines {
                priceWithTax
                shippingMethod {
                    id
                    code
                    name
                    description
                }
            }
            shippingAddress {
                ...DraftOrderShippingAddress
            }
            payments {
                ...Payment
            }
            fulfillments {
                id
                state
                method
                trackingCode
                lines {
                    orderLineId
                    quantity
                }
            }
        }
    `,
    [draftOrderShippingAddressFragment, paymentFragment],
);

const createDraftOrderDocument = graphql(
    `
        mutation CreateDraftOrder {
            createDraftOrder {
                ...OrderWithLines
            }
        }
    `,
    [orderWithLinesFragment],
);

const addItemToDraftOrderDocument = graphql(
    `
        mutation AddItemToDraftOrder($orderId: ID!, $input: AddItemToDraftOrderInput!) {
            addItemToDraftOrder(orderId: $orderId, input: $input) {
                ...OrderWithLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const adjustDraftOrderLineDocument = graphql(
    `
        mutation AdjustDraftOrderLine($orderId: ID!, $input: AdjustDraftOrderLineInput!) {
            adjustDraftOrderLine(orderId: $orderId, input: $input) {
                ...OrderWithLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const removeDraftOrderLineDocument = graphql(
    `
        mutation RemoveDraftOrderLine($orderId: ID!, $orderLineId: ID!) {
            removeDraftOrderLine(orderId: $orderId, orderLineId: $orderLineId) {
                ...OrderWithLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const setCustomerForDraftOrderDocument = graphql(
    `
        mutation SetCustomerForDraftOrder($orderId: ID!, $customerId: ID, $input: CreateCustomerInput) {
            setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId, input: $input) {
                ...OrderWithLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const setShippingAddressForDraftOrderDocument = graphql(
    `
        mutation SetDraftOrderShippingAddress($orderId: ID!, $input: CreateAddressInput!) {
            setDraftOrderShippingAddress(orderId: $orderId, input: $input) {
                ...DraftOrderWithLines
            }
        }
    `,
    [draftOrderWithLinesFragment],
);

const setBillingAddressForDraftOrderDocument = graphql(
    `
        mutation SetDraftOrderBillingAddress($orderId: ID!, $input: CreateAddressInput!) {
            setDraftOrderBillingAddress(orderId: $orderId, input: $input) {
                ...DraftOrderWithLines
                billingAddress {
                    ...DraftOrderShippingAddress
                }
            }
        }
    `,
    [draftOrderWithLinesFragment, draftOrderShippingAddressFragment],
);

const unsetShippingAddressForDraftOrderDocument = graphql(
    `
        mutation UnsetDraftOrderShippingAddress($orderId: ID!) {
            unsetDraftOrderShippingAddress(orderId: $orderId) {
                ...DraftOrderWithLines
            }
        }
    `,
    [draftOrderWithLinesFragment],
);

const unsetBillingAddressForDraftOrderDocument = graphql(
    `
        mutation UnsetDraftOrderBillingAddress($orderId: ID!) {
            unsetDraftOrderBillingAddress(orderId: $orderId) {
                ...DraftOrderWithLines
                billingAddress {
                    ...DraftOrderShippingAddress
                }
            }
        }
    `,
    [draftOrderWithLinesFragment, draftOrderShippingAddressFragment],
);

const applyCouponCodeToDraftOrderDocument = graphql(
    `
        mutation ApplyCouponCodeToDraftOrder($orderId: ID!, $couponCode: String!) {
            applyCouponCodeToDraftOrder(orderId: $orderId, couponCode: $couponCode) {
                ...OrderWithLines
                ... on Order {
                    couponCodes
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const removeCouponCodeFromDraftOrderDocument = graphql(
    `
        mutation RemoveCouponCodeFromDraftOrder($orderId: ID!, $couponCode: String!) {
            removeCouponCodeFromDraftOrder(orderId: $orderId, couponCode: $couponCode) {
                ...OrderWithLines
                ... on Order {
                    couponCodes
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const draftOrderEligibleShippingMethodsDocument = graphql(`
    query DraftOrderEligibleShippingMethods($orderId: ID!) {
        eligibleShippingMethodsForDraftOrder(orderId: $orderId) {
            id
            name
            code
            description
            price
            priceWithTax
            metadata
        }
    }
`);

const setDraftOrderShippingMethodDocument = graphql(
    `
        mutation SetDraftOrderShippingMethod($orderId: ID!, $shippingMethodId: ID!) {
            setDraftOrderShippingMethod(orderId: $orderId, shippingMethodId: $shippingMethodId) {
                ...OrderWithLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderWithLinesFragment],
);

const getOrderPlacedAtDocument = graphql(`
    query GetOrderPlacedAt($id: ID!) {
        order(id: $id) {
            id
            createdAt
            updatedAt
            state
            orderPlacedAt
        }
    }
`);
