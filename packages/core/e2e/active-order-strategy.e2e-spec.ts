import { LanguageCode } from '@vendure/common/lib/generated-types';
import { mergeConfig, orderPercentageDiscount } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { TokenActiveOrderPlugin } from './fixtures/test-plugins/token-active-order-plugin';
import { ResultOf } from './graphql/graphql-admin';
import { graphql, ResultOf as ShopResultOf } from './graphql/graphql-shop';
import { createPromotionDocument, getCustomerListDocument } from './graphql/shared-definitions';
import { addItemToOrderDocument, getActiveOrderDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('custom ActiveOrderStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TokenActiveOrderPlugin],
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
            customFields: {
                Order: [
                    {
                        name: 'message',
                        type: 'string',
                        nullable: true,
                    },
                ],
            },
        }),
    );

    type OrderResult = Extract<
        ShopResultOf<typeof addItemToOrderWithTokenDocument>['addItemToOrder'],
        { __typename?: 'Order' }
    >;
    const orderResultGuard: ErrorResultGuard<OrderResult> = createErrorResultGuard(
        input => !('errorCode' in input) && !('message' in input),
    );

    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

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
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(getCustomerListDocument);
        customers = result.customers.items;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('activeOrder with no createActiveOrder defined returns null', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);

        expect(activeOrder).toBeNull();
    });

    it(
        'addItemToOrder with no createActiveOrder throws',
        assertThrowsWithMessage(async () => {
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
        }, 'No active Order could be determined nor created'),
    );

    it('activeOrder with valid input', async () => {
        const { createOrder } = await shopClient.query(createCustomOrderDocument, {
            customerId: customers[1].id,
        });

        expect(createOrder).toEqual({
            id: 'T_1',
            orderToken: 'token-2',
        });

        await shopClient.asUserWithCredentials(customers[1].emailAddress, 'test');
        const { activeOrder } = await shopClient.query(activeOrderByTokenDocument, {
            // @ts-expect-error
            input: {
                orderToken: { token: 'token-2' },
            },
        });

        expect(activeOrder).toEqual({
            id: 'T_1',
            orderToken: 'token-2',
        });
    });

    it('activeOrder with invalid input', async () => {
        await shopClient.asUserWithCredentials(customers[1].emailAddress, 'test');
        const { activeOrder } = await shopClient.query(activeOrderByTokenDocument, {
            // @ts-expect-error
            input: {
                orderToken: { token: 'invalid' },
            },
        });

        expect(activeOrder).toBeNull();
    });

    it('activeOrder with invalid condition', async () => {
        // wrong customer logged in
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        const { activeOrder } = await shopClient.query(activeOrderByTokenDocument, {
            // @ts-expect-error
            input: {
                orderToken: { token: 'token-2' },
            },
        });

        expect(activeOrder).toBeNull();
    });

    describe('happy path', () => {
        const activeOrderInput = 'activeOrderInput: { orderToken: { token: "token-2" } }';
        const TEST_COUPON_CODE = 'TESTCOUPON';
        let firstOrderLineId: string;

        beforeAll(async () => {
            await shopClient.asUserWithCredentials(customers[1].emailAddress, 'test');
            const result = await adminClient.query(createPromotionDocument, {
                input: {
                    enabled: true,
                    couponCode: TEST_COUPON_CODE,
                    conditions: [],
                    actions: [
                        {
                            code: orderPercentageDiscount.code,
                            arguments: [{ name: 'discount', value: '100' }],
                        },
                    ],
                    translations: [{ languageCode: LanguageCode.en, name: 'Free with test coupon' }],
                },
            });
        });

        it('addItemToOrder', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithTokenDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            orderResultGuard.assertSuccess(addItemToOrder);

            expect(addItemToOrder).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                lines: [
                    {
                        id: 'T_1',
                        productVariant: { id: 'T_1' },
                    },
                ],
            });
            if (!addItemToOrder.lines) {
                throw new Error('No lines found');
            }
            firstOrderLineId = addItemToOrder.lines[0].id;
        });

        it('adjustOrderLine', async () => {
            const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithTokenDocument, {
                orderLineId: firstOrderLineId,
                quantity: 2,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            orderResultGuard.assertSuccess(adjustOrderLine);

            expect(adjustOrderLine).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                lines: [
                    {
                        quantity: 2,
                        productVariant: { id: 'T_1' },
                    },
                ],
            });
        });

        it('removeOrderLine', async () => {
            const { removeOrderLine } = await shopClient.query(removeOrderLineWithTokenDocument, {
                orderLineId: firstOrderLineId,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            orderResultGuard.assertSuccess(removeOrderLine);

            expect(removeOrderLine).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                lines: [],
            });
        });

        it('removeAllOrderLines', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderWithTokenDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);

            const { removeAllOrderLines } = await shopClient.query(removeAllOrderLinesWithTokenDocument, {
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            orderResultGuard.assertSuccess(removeAllOrderLines);
            expect(removeAllOrderLines.lines.length).toBe(0);
        });

        it('applyCouponCode', async () => {
            await shopClient.query(addItemToOrderWithTokenDocument, {
                productVariantId: 'T_1',
                quantity: 1,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            const { applyCouponCode } = await shopClient.query(applyCouponCodeWithTokenDocument, {
                couponCode: TEST_COUPON_CODE,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            orderResultGuard.assertSuccess(applyCouponCode);

            expect(applyCouponCode).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                couponCodes: [TEST_COUPON_CODE],
                discounts: [{ description: 'Free with test coupon' }],
            });
        });

        it('removeCouponCode', async () => {
            const { removeCouponCode } = await shopClient.query(removeCouponCodeWithTokenDocument, {
                couponCode: TEST_COUPON_CODE,
                activeOrderInput: { orderToken: { token: 'token-2' } } as any,
            });
            if (!removeCouponCode) {
                throw new Error('No removeCouponCode found');
            }
            orderResultGuard.assertSuccess(removeCouponCode);

            expect(removeCouponCode).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                couponCodes: [],
                discounts: [],
            });
        });

        it('setOrderShippingAddress', async () => {
            const { setOrderShippingAddress } = await shopClient.query(
                setOrderShippingAddressWithTokenDocument,
                {
                    input: {
                        streetLine1: 'Shipping Street',
                        countryCode: 'AT',
                    },
                    activeOrderInput: { orderToken: { token: 'token-2' } } as any,
                },
            );
            orderResultGuard.assertSuccess(setOrderShippingAddress);

            expect(setOrderShippingAddress).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                shippingAddress: {
                    streetLine1: 'Shipping Street',
                    country: 'Austria',
                },
            });
        });

        it('setOrderBillingAddress', async () => {
            const { setOrderBillingAddress } = await shopClient.query(
                setOrderBillingAddressWithTokenDocument,
                {
                    input: {
                        streetLine1: 'Billing Street',
                        countryCode: 'AT',
                    },
                    activeOrderInput: { orderToken: { token: 'token-2' } } as any,
                },
            );
            orderResultGuard.assertSuccess(setOrderBillingAddress);

            expect(setOrderBillingAddress).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                billingAddress: {
                    streetLine1: 'Billing Street',
                    country: 'Austria',
                },
            });
        });

        it('unsetOrderShippingAddress', async () => {
            const { unsetOrderShippingAddress } = await shopClient.query(
                unsetOrderShippingAddressWithTokenDocument,
                {
                    // @ts-expect-error
                    activeOrderInput: { orderToken: { token: 'token-2' } },
                },
            );
            orderResultGuard.assertSuccess(unsetOrderShippingAddress);

            expect(unsetOrderShippingAddress).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                shippingAddress: {
                    streetLine1: null,
                    country: null,
                },
            });
        });

        it('unsetOrderBillingAddress', async () => {
            const { unsetOrderBillingAddress } = await shopClient.query(
                unsetOrderBillingAddressWithTokenDocument,
                {
                    // @ts-expect-error
                    activeOrderInput: { orderToken: { token: 'token-2' } },
                },
            );
            orderResultGuard.assertSuccess(unsetOrderBillingAddress);

            expect(unsetOrderBillingAddress).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                billingAddress: {
                    streetLine1: null,
                    country: null,
                },
            });
        });

        it('eligibleShippingMethods', async () => {
            const { eligibleShippingMethods } = await shopClient.query(
                eligibleShippingMethodsWithTokenDocument,
                {
                    // @ts-expect-error
                    activeOrderInput: { orderToken: { token: 'token-2' } },
                },
            );
            expect(eligibleShippingMethods).toEqual([
                {
                    id: 'T_1',
                    name: 'Standard Shipping',
                    priceWithTax: 500,
                },
                {
                    id: 'T_2',
                    name: 'Express Shipping',
                    priceWithTax: 1000,
                },
                {
                    id: 'T_3',
                    name: 'Express Shipping (Taxed)',
                    priceWithTax: 1200,
                },
            ]);
        });

        it('setOrderShippingMethod', async () => {
            const { setOrderShippingMethod } = await shopClient.query(
                setOrderShippingMethodWithTokenDocument,
                {
                    shippingMethodId: ['T_1'],
                    // @ts-expect-error
                    activeOrderInput: { orderToken: { token: 'token-2' } },
                },
            );
            orderResultGuard.assertSuccess(setOrderShippingMethod);

            expect(setOrderShippingMethod).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                shippingLines: [{ price: 500 }],
            });
        });

        it('setOrderCustomFields', async () => {
            const { setOrderCustomFields } = await shopClient.query(setOrderCustomFieldsWithTokenDocument, {
                input: { customFields: { message: 'foo' } },
                // @ts-expect-error
                activeOrderInput: { orderToken: { token: 'token-2' } },
            });
            orderResultGuard.assertSuccess(setOrderCustomFields);

            expect(setOrderCustomFields).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                customFields: { message: 'foo' },
            });
        });

        it('eligiblePaymentMethods', async () => {
            const { eligiblePaymentMethods } = await shopClient.query(
                eligiblePaymentMethodsWithTokenDocument,
                {
                    // @ts-expect-error
                    activeOrderInput: { orderToken: { token: 'token-2' } },
                },
            );
            expect(eligiblePaymentMethods).toEqual([
                {
                    id: 'T_1',
                    name: 'test-payment-method',
                    code: 'test-payment-method',
                },
            ]);
        });

        it('nextOrderStates', async () => {
            const { nextOrderStates } = await shopClient.query(nextOrderStatesWithTokenDocument, {
                // @ts-expect-error
                activeOrderInput: { orderToken: { token: 'token-2' } },
            });
            expect(nextOrderStates).toEqual(['ArrangingPayment', 'Cancelled']);
        });

        it('transitionOrderToState', async () => {
            const { transitionOrderToState } = await shopClient.query(
                transitionOrderToStateWithTokenDocument,
                {
                    state: 'ArrangingPayment',
                    // @ts-expect-error
                    activeOrderInput: { orderToken: { token: 'token-2' } },
                },
            );
            if (!transitionOrderToState) {
                throw new Error('No transitionOrderToState found');
            }
            orderResultGuard.assertSuccess(transitionOrderToState);

            expect(transitionOrderToState).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                state: 'ArrangingPayment',
            });
        });

        it('addPaymentToOrder', async () => {
            const { addPaymentToOrder } = await shopClient.query(addPaymentToOrderWithTokenDocument, {
                input: { method: 'test-payment-method', metadata: {} },
                // @ts-expect-error
                activeOrderInput: { orderToken: { token: 'token-2' } },
            });
            if (!addPaymentToOrder) {
                throw new Error('No addPaymentToOrder found');
            }
            orderResultGuard.assertSuccess(addPaymentToOrder);

            expect(addPaymentToOrder).toEqual({
                id: 'T_1',
                orderToken: 'token-2',
                payments: [
                    {
                        state: 'Settled',
                    },
                ],
                state: 'PaymentSettled',
            });
        });
    });
});

export const activeOrderByTokenDocument = graphql(`
    query ActiveOrderByToken($input: ActiveOrderInput) {
        activeOrder(activeOrderInput: $input) {
            id
            orderToken
        }
    }
`);

export const createCustomOrderDocument = graphql(`
    mutation CreateCustomOrder($customerId: ID!) {
        createOrder(customerId: $customerId) {
            id
            orderToken
        }
    }
`);

const addItemToOrderWithTokenDocument = graphql(`
    mutation AddItemToOrderWithToken(
        $productVariantId: ID!
        $quantity: Int!
        $activeOrderInput: ActiveOrderInput
    ) {
        addItemToOrder(
            productVariantId: $productVariantId
            quantity: $quantity
            activeOrderInput: $activeOrderInput
        ) {
            ... on Order {
                id
                orderToken
                lines {
                    id
                    productVariant {
                        id
                    }
                }
            }
        }
    }
`);

const adjustOrderLineWithTokenDocument = graphql(`
    mutation AdjustOrderLineWithToken(
        $orderLineId: ID!
        $quantity: Int!
        $activeOrderInput: ActiveOrderInput
    ) {
        adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                lines {
                    quantity
                    productVariant {
                        id
                    }
                }
            }
        }
    }
`);

const removeOrderLineWithTokenDocument = graphql(`
    mutation RemoveOrderLineWithToken($orderLineId: ID!, $activeOrderInput: ActiveOrderInput) {
        removeOrderLine(orderLineId: $orderLineId, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                lines {
                    id
                }
            }
        }
    }
`);

const removeAllOrderLinesWithTokenDocument = graphql(`
    mutation RemoveAllOrderLinesWithToken($activeOrderInput: ActiveOrderInput) {
        removeAllOrderLines(activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                lines {
                    id
                }
            }
        }
    }
`);

const applyCouponCodeWithTokenDocument = graphql(`
    mutation ApplyCouponCodeWithToken($couponCode: String!, $activeOrderInput: ActiveOrderInput) {
        applyCouponCode(couponCode: $couponCode, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                couponCodes
                discounts {
                    description
                }
            }
        }
    }
`);

const removeCouponCodeWithTokenDocument = graphql(`
    mutation RemoveCouponCodeWithToken($couponCode: String!, $activeOrderInput: ActiveOrderInput) {
        removeCouponCode(couponCode: $couponCode, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                couponCodes
                discounts {
                    description
                }
            }
        }
    }
`);

const setOrderShippingAddressWithTokenDocument = graphql(`
    mutation SetOrderShippingAddressWithToken(
        $input: CreateAddressInput!
        $activeOrderInput: ActiveOrderInput
    ) {
        setOrderShippingAddress(input: $input, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                shippingAddress {
                    streetLine1
                    country
                }
            }
        }
    }
`);

const setOrderBillingAddressWithTokenDocument = graphql(`
    mutation SetOrderBillingAddressWithToken(
        $input: CreateAddressInput!
        $activeOrderInput: ActiveOrderInput
    ) {
        setOrderBillingAddress(input: $input, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                billingAddress {
                    streetLine1
                    country
                }
            }
        }
    }
`);

const unsetOrderShippingAddressWithTokenDocument = graphql(`
    mutation UnsetOrderShippingAddressWithToken($activeOrderInput: ActiveOrderInput) {
        unsetOrderShippingAddress(activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                shippingAddress {
                    streetLine1
                    country
                }
            }
        }
    }
`);

const unsetOrderBillingAddressWithTokenDocument = graphql(`
    mutation UnsetOrderBillingAddressWithToken($activeOrderInput: ActiveOrderInput) {
        unsetOrderBillingAddress(activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                billingAddress {
                    streetLine1
                    country
                }
            }
        }
    }
`);

const eligibleShippingMethodsWithTokenDocument = graphql(`
    query EligibleShippingMethodsWithToken($activeOrderInput: ActiveOrderInput) {
        eligibleShippingMethods(activeOrderInput: $activeOrderInput) {
            id
            name
            priceWithTax
        }
    }
`);

const setOrderShippingMethodWithTokenDocument = graphql(`
    mutation SetOrderShippingMethodWithToken($shippingMethodId: [ID!]!, $activeOrderInput: ActiveOrderInput) {
        setOrderShippingMethod(shippingMethodId: $shippingMethodId, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                shippingLines {
                    price
                }
            }
        }
    }
`);

const setOrderCustomFieldsWithTokenDocument = graphql(`
    mutation SetOrderCustomFieldsWithToken($input: UpdateOrderInput!, $activeOrderInput: ActiveOrderInput) {
        setOrderCustomFields(input: $input, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                customFields {
                    message
                }
            }
        }
    }
`);

const eligiblePaymentMethodsWithTokenDocument = graphql(`
    query EligiblePaymentMethodsWithToken($activeOrderInput: ActiveOrderInput) {
        eligiblePaymentMethods(activeOrderInput: $activeOrderInput) {
            id
            name
            code
        }
    }
`);

const nextOrderStatesWithTokenDocument = graphql(`
    query NextOrderStatesWithToken($activeOrderInput: ActiveOrderInput) {
        nextOrderStates(activeOrderInput: $activeOrderInput)
    }
`);

const transitionOrderToStateWithTokenDocument = graphql(`
    mutation TransitionOrderToStateWithToken($state: String!, $activeOrderInput: ActiveOrderInput) {
        transitionOrderToState(state: $state, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                state
            }
        }
    }
`);

const addPaymentToOrderWithTokenDocument = graphql(`
    mutation AddPaymentToOrderWithToken($input: PaymentInput!, $activeOrderInput: ActiveOrderInput) {
        addPaymentToOrder(input: $input, activeOrderInput: $activeOrderInput) {
            ... on Order {
                id
                orderToken
                state
                payments {
                    state
                }
            }
        }
    }
`);
