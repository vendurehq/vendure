/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode } from '@vendure/common/lib/generated-shop-types';
import { GlobalFlag, LanguageCode } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import {
    Asset,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    manualFulfillmentHandler,
    mergeConfig,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import { fail } from 'assert';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    testErrorPaymentMethod,
    testFailingPaymentMethod,
    testSuccessfulPaymentMethod,
} from './fixtures/test-payment-methods';
import {
    countryCodeShippingEligibilityChecker,
    hydratingShippingEligibilityChecker,
} from './fixtures/test-shipping-eligibility-checkers';
import { ResultOf, VariablesOf } from './graphql/graphql-admin';
import { FragmentOf } from './graphql/graphql-shop';
import {
    attemptLoginDocument,
    cancelOrderDocument,
    createShippingMethodDocument,
    deleteProductDocument,
    deleteProductVariantDocument,
    deleteShippingMethodDocument,
    getCountryListDocument,
    getCustomerDocument,
    getCustomerListDocument,
    getProductWithVariantsDocument,
    getShippingMethodListDocument,
    updateCountryDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    activeOrderCustomerDocument,
    addItemToOrderDocument,
    addItemToOrderWithCustomFieldsDocument,
    addMultipleItemsToOrderWithCustomFieldsDocument,
    addPaymentDocument,
    adjustItemQuantityDocument,
    adjustOrderLineWithCustomFieldsDocument,
    currentUserFragment,
    getActiveOrderAddressesDocument,
    getActiveOrderDocument,
    getActiveOrderOrdersDocument,
    getActiveOrderPaymentsDocument,
    getActiveOrderShippingBillingDocument,
    getActiveOrderWithPaymentsDocument,
    getAvailableCountriesDocument,
    getEligibleShippingMethodsDocument,
    getNextStatesDocument,
    getOrderByCodeDocument,
    getOrderCustomFieldsDocument,
    getOrderWithOrderLineCustomFieldsDocument,
    logOutDocument,
    removeAllOrderLinesDocument,
    removeItemFromOrderDocument,
    setBillingAddressDocument,
    setCustomerDocument,
    setOrderCustomFieldsDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    testOrderFragment,
    transitionToStateDocument,
    unsetBillingAddressDocument,
    unsetShippingAddressDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

type CreateAddressInput = VariablesOf<typeof setShippingAddressDocument>['input'];
type CreateShippingMethodInput = VariablesOf<typeof createShippingMethodDocument>['input'];

describe('Shop orders', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [
                    testSuccessfulPaymentMethod,
                    testFailingPaymentMethod,
                    testErrorPaymentMethod,
                ],
            },
            shippingOptions: {
                shippingEligibilityCheckers: [
                    defaultShippingEligibilityChecker,
                    countryCodeShippingEligibilityChecker,
                    hydratingShippingEligibilityChecker,
                ],
            },
            customFields: {
                Order: [
                    { name: 'giftWrap', type: 'boolean', defaultValue: false },
                    { name: 'orderImage', type: 'relation', entity: Asset },
                ],
                OrderLine: [
                    { name: 'notes', type: 'string' },
                    { name: 'privateField', type: 'string', public: false },
                    { name: 'lineImage', type: 'relation', entity: Asset },
                    { name: 'lineImages', type: 'relation', list: true, entity: Asset },
                    { name: 'dropShip', type: 'boolean', defaultValue: false },
                ],
            },
            orderOptions: {
                orderItemsLimit: 199,
            },
        }),
    );

    type OrderSuccessResult = FragmentOf<typeof updatedOrderFragment>;
    const orderResultGuard: ErrorResultGuard<OrderSuccessResult> = createErrorResultGuard(
        input => !!input.lines,
    );

    const activeOrderGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof getActiveOrderShippingBillingDocument>['activeOrder']>
    > = createErrorResultGuard(input => input !== null);

    const orderWithCustomFieldsGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof getOrderWithOrderLineCustomFieldsDocument>['activeOrder']>
    > = createErrorResultGuard(input => input !== null);

    type CurrentUserShopFragment = FragmentOf<typeof currentUserFragment>;
    const currentUserGuard: ErrorResultGuard<CurrentUserShopFragment> = createErrorResultGuard(
        input => input.identifier != null,
    );

    type ActiveOrderCustomerFragment = FragmentOf<typeof activeOrderCustomerDocument>;
    const setCustomerForOrderGuard: ErrorResultGuard<ActiveOrderCustomerFragment> = createErrorResultGuard(
        input => 'lines' in input && !!input.lines,
    );

    type TestOrderFragmentType = FragmentOf<typeof testOrderFragment>;
    const testOrderGuard: ErrorResultGuard<TestOrderFragmentType> = createErrorResultGuard(
        input => !!input.lines,
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                    {
                        name: testFailingPaymentMethod.code,
                        handler: { code: testFailingPaymentMethod.code, arguments: [] },
                    },
                    {
                        name: testErrorPaymentMethod.code,
                        handler: { code: testErrorPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('availableCountries returns enabled countries', async () => {
        // disable Austria
        const { countries } = await adminClient.query(getCountryListDocument, {});
        const AT = countries.items.find(c => c.code === 'AT')!;
        await adminClient.query(updateCountryDocument, {
            input: {
                id: AT.id,
                enabled: false,
            },
        });

        const result = await shopClient.query(getAvailableCountriesDocument);
        expect(result.availableCountries.length).toBe(countries.items.length - 1);
        expect(result.availableCountries.find(c => c.id === AT.id)).toBeUndefined();
    });

    describe('ordering as anonymous user', () => {
        let firstOrderLineId: string;
        let createdCustomerId: string;
        let orderCode: string;

        it('addItemToOrder starts with no session token', () => {
            expect(shopClient.getAuthToken()).toBeFalsy();
        });

        it('activeOrder returns null before any items have been added', async () => {
            const result = await shopClient.query(getActiveOrderDocument);
            expect(result.activeOrder).toBeNull();
        });

        it('activeOrder creates an anonymous session', () => {
            expect(shopClient.getAuthToken()).not.toBe('');
        });

        it('addItemToOrder creates a new Order with an item', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].quantity).toBe(1);
            expect(addItemToOrder.lines[0].productVariant.id).toBe('T_1');
            expect(addItemToOrder.lines[0].id).toBe('T_1');
            firstOrderLineId = addItemToOrder.lines[0].id;
            orderCode = addItemToOrder.code;
        });

        it(
            'addItemToOrder errors with an invalid productVariantId',
            assertThrowsWithMessage(
                () =>
                    shopClient.query(addItemToOrderDocument, {
                        productVariantId: 'T_999',
                        quantity: 1,
                    }),
                'No ProductVariant with the id "999" could be found',
            ),
        );

        it('addItemToOrder errors with a negative quantity', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_999',
                quantity: -3,
            });

            orderResultGuard.assertErrorResult(addItemToOrder);
            expect(addItemToOrder.message).toEqual('The quantity for an OrderItem cannot be negative');
            expect(addItemToOrder.errorCode).toEqual(ErrorCode.NEGATIVE_QUANTITY_ERROR);
        });

        it('addItemToOrder with an existing productVariantId adds quantity to the existing OrderLine', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].quantity).toBe(3);
        });

        describe('OrderLine customFields', () => {
            it('addItemToOrder with private customFields errors', async () => {
                try {
                    await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                        productVariantId: 'T_2',
                        quantity: 1,
                        customFields: {
                            privateField: 'oh no!', // Testing that private fields are rejected
                        },
                    });
                    fail('Should have thrown');
                } catch (e: any) {
                    expect(e.response.errors[0].extensions.code).toBe('BAD_USER_INPUT');
                }
            });

            it('addItemToOrder with equal customFields adds quantity to the existing OrderLine', async () => {
                const { addItemToOrder: add1 } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: 'T_2',
                        quantity: 1,
                        customFields: {
                            notes: 'note1',
                        },
                    },
                );
                orderResultGuard.assertSuccess(add1);
                expect(add1.lines.length).toBe(2);
                expect(add1.lines[1].quantity).toBe(1);

                const { addItemToOrder: add2 } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: 'T_2',
                        quantity: 1,
                        customFields: {
                            notes: 'note1',
                        },
                    },
                );
                orderResultGuard.assertSuccess(add2);
                expect(add2.lines.length).toBe(2);
                expect(add2.lines[1].quantity).toBe(2);

                await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: add2.lines[1].id,
                });
            });

            it('addItemToOrder with different customFields adds quantity to a new OrderLine', async () => {
                const { addItemToOrder: add1 } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: 'T_3',
                        quantity: 1,
                        customFields: {
                            notes: 'note2',
                        },
                    },
                );
                orderResultGuard.assertSuccess(add1);
                expect(add1.lines.length).toBe(2);
                expect(add1.lines[1].quantity).toBe(1);

                const { addItemToOrder: add2 } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: 'T_3',
                        quantity: 1,
                        customFields: {
                            notes: 'note3',
                        },
                    },
                );
                orderResultGuard.assertSuccess(add2);
                expect(add2.lines.length).toBe(3);
                expect(add2.lines[1].quantity).toBe(1);
                expect(add2.lines[2].quantity).toBe(1);

                await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: add2.lines[1].id,
                });
                await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: add2.lines[2].id,
                });
            });

            // https://github.com/vendurehq/vendure/issues/1670
            it('adding a second item after adjusting custom field adds new OrderLine', async () => {
                const { addItemToOrder: add1 } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: 'T_3',
                        quantity: 1,
                    },
                );
                orderResultGuard.assertSuccess(add1);
                expect(add1.lines.length).toBe(2);
                expect(add1.lines[1].quantity).toBe(1);

                const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                    orderLineId: add1.lines[1].id,
                    quantity: 1,
                    customFields: {
                        notes: 'updated notes',
                    },
                });
                orderResultGuard.assertSuccess(adjustOrderLine);
                expect(adjustOrderLine.lines[1].customFields).toEqual({
                    lineImage: null,
                    lineImages: [],
                    notes: 'updated notes',
                });
                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);
                expect(activeOrder.lines[1].customFields).toEqual({
                    lineImage: null,
                    lineImages: [],
                    notes: 'updated notes',
                });
                const updatedNotesLineId = activeOrder.lines[1].id;

                const { addItemToOrder: add2 } = await shopClient.query(
                    addItemToOrderWithCustomFieldsDocument,
                    {
                        productVariantId: 'T_3',
                        quantity: 1,
                    },
                );
                orderResultGuard.assertSuccess(add2);
                expect(add2.lines.length).toBe(3);
                expect(add2.lines[1].quantity).toBe(1);
                expect(add2.lines[2].quantity).toBe(1);

                const { activeOrder: activeOrder2 } = await shopClient.query(
                    getOrderWithOrderLineCustomFieldsDocument,
                );
                orderWithCustomFieldsGuard.assertSuccess(activeOrder2);
                expect(
                    activeOrder2.lines.find((l: any) => l.id === updatedNotesLineId)?.customFields,
                ).toEqual({
                    lineImage: null,
                    lineImages: [],
                    notes: 'updated notes',
                });

                // clean up
                await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: add2.lines[1].id,
                });
                const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: add2.lines[2].id,
                });
                orderResultGuard.assertSuccess(removeOrderLine);
                expect(removeOrderLine.lines.length).toBe(1);
            });

            it('addItemToOrder with relation customField', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: 'T_3',
                    quantity: 1,
                    customFields: {
                        lineImageId: 'T_1',
                    },
                });

                orderResultGuard.assertSuccess(addItemToOrder);
                expect(addItemToOrder.lines.length).toBe(2);
                expect(addItemToOrder.lines[1].quantity).toBe(1);

                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);

                expect(activeOrder.lines[1].customFields.lineImage).toEqual({ id: 'T_1' });
            });

            it('addItemToOrder with equal relation customField adds to quantity', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: 'T_3',
                    quantity: 1,
                    customFields: {
                        lineImageId: 'T_1',
                    },
                });

                orderResultGuard.assertSuccess(addItemToOrder);
                expect(addItemToOrder.lines.length).toBe(2);
                expect(addItemToOrder.lines[1].quantity).toBe(2);

                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);

                expect(activeOrder.lines[1].customFields.lineImage).toEqual({ id: 'T_1' });
            });

            it('addItemToOrder with different relation customField adds new line', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: 'T_3',
                    quantity: 1,
                    customFields: {
                        lineImageId: 'T_2',
                    },
                });

                orderResultGuard.assertSuccess(addItemToOrder);
                expect(addItemToOrder.lines.length).toBe(3);
                expect(addItemToOrder.lines[2].quantity).toBe(1);

                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);

                expect(activeOrder.lines[2].customFields.lineImage).toEqual({ id: 'T_2' });
            });

            it('adjustOrderLine updates relation reference', async () => {
                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);
                const { adjustOrderLine } = await shopClient.query(adjustOrderLineWithCustomFieldsDocument, {
                    orderLineId: activeOrder.lines[2].id,
                    quantity: 1,
                    customFields: {
                        lineImageId: 'T_1',
                    },
                });
                orderResultGuard.assertSuccess(adjustOrderLine);

                expect(adjustOrderLine.lines[2].customFields.lineImage).toEqual({ id: 'T_1' });

                orderWithCustomFieldsGuard.assertSuccess(activeOrder);
                await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: activeOrder.lines[2].id,
                });
                const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: activeOrder.lines[1].id,
                });
                orderResultGuard.assertSuccess(removeOrderLine);
                expect(removeOrderLine.lines.length).toBe(1);
            });

            it('addItemToOrder with list relation customField', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: 'T_3',
                    quantity: 1,
                    customFields: {
                        lineImagesIds: ['T_1', 'T_2'],
                    },
                });

                orderResultGuard.assertSuccess(addItemToOrder);
                expect(addItemToOrder.lines.length).toBe(2);
                expect(addItemToOrder.lines[1].quantity).toBe(1);

                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);
                expect(activeOrder.lines[1].customFields.lineImages.length).toBe(2);
                expect(activeOrder.lines[1].customFields.lineImages).toContainEqual({ id: 'T_1' });
                expect(activeOrder.lines[1].customFields.lineImages).toContainEqual({ id: 'T_2' });
            });

            it('addItemToOrder with equal list relation customField adds to quantity', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: 'T_3',
                    quantity: 1,
                    customFields: {
                        lineImagesIds: ['T_1', 'T_2'],
                    },
                });

                orderResultGuard.assertSuccess(addItemToOrder);
                expect(addItemToOrder.lines.length).toBe(2);
                expect(addItemToOrder.lines[1].quantity).toBe(2);

                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);

                expect(activeOrder.lines[1].customFields.lineImages.length).toBe(2);
                expect(activeOrder.lines[1].customFields.lineImages).toContainEqual({ id: 'T_1' });
                expect(activeOrder.lines[1].customFields.lineImages).toContainEqual({ id: 'T_2' });
            });

            it('addItemToOrder with different list relation customField adds new line', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                    productVariantId: 'T_3',
                    quantity: 1,
                    customFields: {
                        lineImagesIds: ['T_1'],
                    },
                });

                orderResultGuard.assertSuccess(addItemToOrder);
                expect(addItemToOrder.lines.length).toBe(3);
                expect(addItemToOrder.lines[2].quantity).toBe(1);

                const { activeOrder } = await shopClient.query(getOrderWithOrderLineCustomFieldsDocument);
                orderWithCustomFieldsGuard.assertSuccess(activeOrder);

                expect(activeOrder.lines[2].customFields.lineImages).toEqual([{ id: 'T_1' }]);
                await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: activeOrder.lines[2].id,
                });
                const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: activeOrder.lines[1].id,
                });
                orderResultGuard.assertSuccess(removeOrderLine);
                expect(removeOrderLine.lines.length).toBe(1);
            });
        });

        it('addItemToOrder errors when going beyond orderItemsLimit', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 200,
            });

            orderResultGuard.assertErrorResult(addItemToOrder);
            expect(addItemToOrder.message).toBe(
                'Cannot add items. An order may consist of a maximum of 199 items',
            );
            expect(addItemToOrder.errorCode).toBe(ErrorCode.ORDER_LIMIT_ERROR);
        });

        it('adjustOrderLine adjusts the quantity', async () => {
            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: firstOrderLineId,
                quantity: 50,
            });
            orderResultGuard.assertSuccess(adjustOrderLine);
            expect(adjustOrderLine.lines.length).toBe(1);
            expect(adjustOrderLine.lines[0].quantity).toBe(50);
        });

        it('adjustOrderLine with quantity 0 removes the line', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_3',
                quantity: 3,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(2);
            expect(addItemToOrder.lines.map(i => i.productVariant.id)).toEqual(['T_1', 'T_3']);

            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: addItemToOrder?.lines[1].id,
                quantity: 0,
            });
            orderResultGuard.assertSuccess(adjustOrderLine);
            expect(adjustOrderLine.lines.length).toBe(1);
            expect(adjustOrderLine.lines.map(i => i.productVariant.id)).toEqual(['T_1']);
        });

        it('adjustOrderLine with quantity > stockOnHand only allows user to have stock on hand', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_3',
                quantity: 111,
            });
            orderResultGuard.assertErrorResult(addItemToOrder);
            // Insufficient stock error should return because there are only 100 available
            expect(addItemToOrder.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');

            // But it should still add the item to the order
            if ('order' in addItemToOrder) {
                expect(addItemToOrder.order.lines[1].quantity).toBe(100);
            } else {
                fail('Expected InsufficientStockError to have order property');
            }

            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: 'order' in addItemToOrder ? addItemToOrder.order.lines[1].id : '',
                quantity: 101,
            });
            testOrderGuard.assertErrorResult(adjustOrderLine);
            expect(adjustOrderLine.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
            expect(adjustOrderLine.message).toBe(
                'Only 100 items were added to the order due to insufficient stock',
            );

            const order = await shopClient.query(getActiveOrderDocument);
            expect(order.activeOrder?.lines[1].quantity).toBe(100);

            // clean up
            const { adjustOrderLine: adjustLine2 } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: 'order' in addItemToOrder ? addItemToOrder.order.lines[1].id : '',
                quantity: 0,
            });
            orderResultGuard.assertSuccess(adjustLine2);
            expect(adjustLine2.lines.length).toBe(1);
            expect(adjustLine2.lines.map(i => i.productVariant.id)).toEqual(['T_1']);
        });

        // https://github.com/vendurehq/vendure/issues/2702
        it('stockOnHand check works with multiple order lines with different custom fields', async () => {
            const variantId = 'T_27';
            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: variantId,
                        stockOnHand: 10,
                        outOfStockThreshold: 0,
                        useGlobalOutOfStockThreshold: false,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });

            expect(updateProductVariants[0]?.stockOnHand).toBe(10);
            expect(updateProductVariants[0]?.id).toBe('T_27');
            expect(updateProductVariants[0]?.trackInventory).toBe(GlobalFlag.TRUE);

            const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 9,
                customFields: {
                    notes: 'abc',
                },
            });

            orderResultGuard.assertSuccess(add1);

            expect(add1.lines.length).toBe(2);
            expect(add1.lines[1].quantity).toBe(9);
            expect(add1.lines[1].productVariant.id).toBe(variantId);

            const { addItemToOrder: add2 } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 2,
                customFields: {
                    notes: 'def',
                },
            });

            orderResultGuard.assertErrorResult(add2);

            expect(add2.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
            expect(add2.message).toBe('Only 1 item was added to the order due to insufficient stock');

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder?.lines.length).toBe(3);
            expect(activeOrder?.lines[1].quantity).toBe(9);
            expect(activeOrder?.lines[2].quantity).toBe(1);

            // clean up
            await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: activeOrder!.lines[1].id,
            });
            await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: activeOrder!.lines[2].id,
            });
        });

        it('adjustOrderLine handles stockOnHand correctly with multiple order lines with different custom fields when out of stock', async () => {
            const variantId = 'T_27';
            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: variantId,
                        stockOnHand: 10,
                        outOfStockThreshold: 0,
                        useGlobalOutOfStockThreshold: false,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });

            expect(updateProductVariants[0]?.stockOnHand).toBe(10);
            expect(updateProductVariants[0]?.id).toBe('T_27');
            expect(updateProductVariants[0]?.trackInventory).toBe(GlobalFlag.TRUE);

            const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 5,
                customFields: {
                    notes: 'abc',
                },
            });

            orderResultGuard.assertSuccess(add1);

            expect(add1.lines.length).toBe(2);
            expect(add1.lines[1].quantity).toBe(5);
            expect(add1.lines[1].productVariant.id).toBe(variantId);

            const { addItemToOrder: add2 } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 5,
                customFields: {
                    notes: 'def',
                },
            });

            orderResultGuard.assertSuccess(add2);

            expect(add2.lines.length).toBe(3);
            expect(add2.lines[2].quantity).toBe(5);
            expect(add2.lines[2].productVariant.id).toBe(variantId);

            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: add2.lines[1].id,
                quantity: 10,
            });
            testOrderGuard.assertErrorResult(adjustOrderLine);

            expect(adjustOrderLine.message).toBe(
                'Only 5 items were added to the order due to insufficient stock',
            );
            expect(adjustOrderLine.errorCode).toBe(ErrorCode.INSUFFICIENT_STOCK_ERROR);

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            expect(activeOrder?.lines.length).toBe(3);
            expect(activeOrder?.lines[1].quantity).toBe(5);
            expect(activeOrder?.lines[2].quantity).toBe(5);

            // clean up
            await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: activeOrder!.lines[1].id,
            });
            await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: activeOrder!.lines[2].id,
            });
        });

        it('adjustOrderLine handles stockOnHand correctly with multiple order lines with different custom fields', async () => {
            const variantId = 'T_27';
            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: variantId,
                        stockOnHand: 10,
                        outOfStockThreshold: 0,
                        useGlobalOutOfStockThreshold: false,
                        trackInventory: GlobalFlag.TRUE,
                    },
                ],
            });

            expect(updateProductVariants[0]?.stockOnHand).toBe(10);
            expect(updateProductVariants[0]?.id).toBe('T_27');
            expect(updateProductVariants[0]?.trackInventory).toBe(GlobalFlag.TRUE);

            const { addItemToOrder: add1 } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 5,
                customFields: {
                    notes: 'abc',
                },
            });

            orderResultGuard.assertSuccess(add1);

            expect(add1.lines.length).toBe(2);
            expect(add1.lines[1].quantity).toBe(5);
            expect(add1.lines[1].productVariant.id).toBe(variantId);

            const { addItemToOrder: add2 } = await shopClient.query(addItemToOrderWithCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 5,
                customFields: {
                    notes: 'def',
                },
            });

            orderResultGuard.assertSuccess(add2);

            expect(add2.lines.length).toBe(3);
            expect(add2.lines[2].quantity).toBe(5);
            expect(add2.lines[2].productVariant.id).toBe(variantId);

            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: add2.lines[1].id,
                quantity: 3,
            });

            orderResultGuard.assertSuccess(adjustOrderLine);

            expect(adjustOrderLine?.lines.length).toBe(3);
            expect(adjustOrderLine?.lines[1].quantity).toBe(3);
            expect(adjustOrderLine?.lines[2].quantity).toBe(5);

            // clean up
            await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: adjustOrderLine.lines[1].id,
            });
            await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: adjustOrderLine.lines[2].id,
            });
        });

        it('adjustOrderLine errors when going beyond orderItemsLimit', async () => {
            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: firstOrderLineId,
                quantity: 200,
            });
            testOrderGuard.assertErrorResult(adjustOrderLine);
            expect(adjustOrderLine.message).toBe(
                'Cannot add items. An order may consist of a maximum of 199 items',
            );
            expect(adjustOrderLine.errorCode).toBe(ErrorCode.ORDER_LIMIT_ERROR);
        });

        it('adjustOrderLine errors with a negative quantity', async () => {
            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: firstOrderLineId,
                quantity: -3,
            });
            testOrderGuard.assertErrorResult(adjustOrderLine);
            expect(adjustOrderLine.message).toBe('The quantity for an OrderItem cannot be negative');
            expect(adjustOrderLine.errorCode).toBe(ErrorCode.NEGATIVE_QUANTITY_ERROR);
        });

        it(
            'adjustOrderLine errors with an invalid orderLineId',
            assertThrowsWithMessage(
                () =>
                    shopClient.query(adjustItemQuantityDocument, {
                        orderLineId: 'T_999',
                        quantity: 5,
                    }),
                'This order does not contain an OrderLine with the id 999',
            ),
        );

        it('removeItemFromOrder removes the correct item', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_3',
                quantity: 3,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(2);
            expect(addItemToOrder.lines.map(i => i.productVariant.id)).toEqual(['T_1', 'T_3']);

            const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: firstOrderLineId,
            });
            orderResultGuard.assertSuccess(removeOrderLine);
            expect(removeOrderLine.lines.length).toBe(1);
            expect(removeOrderLine.lines.map(i => i.productVariant.id)).toEqual(['T_3']);
        });

        it(
            'removeItemFromOrder errors with an invalid orderItemId',
            assertThrowsWithMessage(
                () =>
                    shopClient.query(removeItemFromOrderDocument, {
                        orderLineId: 'T_999',
                    }),
                'This order does not contain an OrderLine with the id 999',
            ),
        );

        it('nextOrderStates returns next valid states', async () => {
            const result = await shopClient.query(getNextStatesDocument);

            expect(result.nextOrderStates).toEqual(['ArrangingPayment', 'Cancelled']);
        });

        it('transitionOrderToState returns error result for invalid state', async () => {
            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'Completed',
            });
            if (transitionOrderToState) {
                testOrderGuard.assertErrorResult(transitionOrderToState);
            } else {
                fail('Expected transitionOrderToState to exist');
            }

            expect(transitionOrderToState.message).toBe(
                'Cannot transition Order from "AddingItems" to "Completed"',
            );
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
        });

        it('attempting to transition to ArrangingPayment returns error result when Order has no Customer', async () => {
            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            if (transitionOrderToState) {
                testOrderGuard.assertErrorResult(transitionOrderToState);
            } else {
                fail('Expected transitionOrderToState to exist');
            }

            expect(transitionOrderToState.transitionError).toBe(
                'Cannot transition Order to the "ArrangingPayment" state without Customer details',
            );
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
        });

        it('setCustomerForOrder returns error result on email address conflict', async () => {
            const { customers } = await adminClient.query(getCustomerListDocument);

            const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: customers.items[0].emailAddress,
                    firstName: 'Test',
                    lastName: 'Person',
                },
            });
            setCustomerForOrderGuard.assertErrorResult(setCustomerForOrder);

            expect(setCustomerForOrder.message).toBe('The email address is not available.');
            expect(setCustomerForOrder.errorCode).toBe(ErrorCode.EMAIL_ADDRESS_CONFLICT_ERROR);
        });

        it('setCustomerForOrder creates a new Customer and associates it with the Order', async () => {
            const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: 'test@test.com',
                    firstName: 'Test',
                    lastName: 'Person',
                },
            });
            orderResultGuard.assertSuccess(setCustomerForOrder);

            const customer = setCustomerForOrder.customer;
            if (!customer || !('firstName' in customer)) {
                fail('Expected customer with firstName to exist');
            }
            expect(customer.firstName).toBe('Test');
            expect(customer.lastName).toBe('Person');
            expect(customer.emailAddress).toBe('test@test.com');
            createdCustomerId = customer.id;
        });

        it('setCustomerForOrder updates the existing customer if Customer already set', async () => {
            const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: 'test@test.com',
                    firstName: 'Changed',
                    lastName: 'Person',
                },
            });
            orderResultGuard.assertSuccess(setCustomerForOrder);

            const customer = setCustomerForOrder.customer;
            if (!customer || !('firstName' in customer)) {
                fail('Expected customer with firstName to exist');
            }
            expect(customer.firstName).toBe('Changed');
            expect(customer.lastName).toBe('Person');
            expect(customer.emailAddress).toBe('test@test.com');
            expect(customer.id).toBe(createdCustomerId);
        });

        describe('address handling', () => {
            const shippingAddress: CreateAddressInput = {
                fullName: 'name',
                company: 'company',
                streetLine1: '12 Shipping Street',
                streetLine2: null,
                city: 'foo',
                province: 'bar',
                postalCode: '123456',
                countryCode: 'US',
                phoneNumber: '4444444',
            };

            const billingAddress: CreateAddressInput = {
                fullName: 'name',
                company: 'company',
                streetLine1: '22 Billing Avenue',
                streetLine2: null,
                city: 'foo',
                province: 'bar',
                postalCode: '123456',
                countryCode: 'US',
                phoneNumber: '4444444',
            };

            it('setOrderShippingAddress sets shipping address', async () => {
                const { setOrderShippingAddress } = await shopClient.query(setShippingAddressDocument, {
                    input: shippingAddress,
                });

                orderResultGuard.assertSuccess(setOrderShippingAddress);

                expect(setOrderShippingAddress.shippingAddress).toEqual({
                    fullName: 'name',
                    company: 'company',
                    streetLine1: '12 Shipping Street',
                    streetLine2: null,
                    city: 'foo',
                    province: 'bar',
                    postalCode: '123456',
                    country: 'United States of America',
                    phoneNumber: '4444444',
                });
            });

            it('setOrderBillingAddress sets billing address', async () => {
                const { setOrderBillingAddress } = await shopClient.query(setBillingAddressDocument, {
                    input: billingAddress,
                });

                orderResultGuard.assertSuccess(setOrderBillingAddress);

                expect(setOrderBillingAddress.billingAddress).toEqual({
                    fullName: 'name',
                    company: 'company',
                    streetLine1: '22 Billing Avenue',
                    streetLine2: null,
                    city: 'foo',
                    province: 'bar',
                    postalCode: '123456',
                    country: 'United States of America',
                    phoneNumber: '4444444',
                });
            });

            it('unsetOrderShippingAddress unsets shipping address', async () => {
                const { unsetOrderShippingAddress } = await shopClient.query(unsetShippingAddressDocument);

                orderResultGuard.assertSuccess(unsetOrderShippingAddress);

                expect(unsetOrderShippingAddress.shippingAddress).toEqual({
                    fullName: null,
                    company: null,
                    streetLine1: null,
                    streetLine2: null,
                    city: null,
                    province: null,
                    postalCode: null,
                    country: null,
                    phoneNumber: null,
                });

                // Reset the shipping address for subsequent tests
                await shopClient.query(setShippingAddressDocument, {
                    input: shippingAddress,
                });
            });

            it('unsetOrderBillingAddress unsets billing address', async () => {
                const { unsetOrderBillingAddress } = await shopClient.query(unsetBillingAddressDocument);

                orderResultGuard.assertSuccess(unsetOrderBillingAddress);

                expect(unsetOrderBillingAddress.billingAddress).toEqual({
                    fullName: null,
                    company: null,
                    streetLine1: null,
                    streetLine2: null,
                    city: null,
                    province: null,
                    postalCode: null,
                    country: null,
                    phoneNumber: null,
                });

                // Reset the billing address for subsequent tests
                await shopClient.query(setBillingAddressDocument, {
                    input: billingAddress,
                });
            });
        });

        it('customer default Addresses are not updated before payment', async () => {
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            const { customer } = await adminClient.query(getCustomerDocument, {
                id: activeOrder!.customer!.id,
            });

            expect(customer!.addresses).toEqual([]);
        });

        it('attempting to transition to ArrangingPayment returns error result when Order has no ShippingMethod', async () => {
            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            if (transitionOrderToState) {
                testOrderGuard.assertErrorResult(transitionOrderToState);
            } else {
                fail('Expected transitionOrderToState to exist');
            }

            expect(transitionOrderToState.transitionError).toBe(
                'Cannot transition Order to the "ArrangingPayment" state without a ShippingMethod',
            );
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
        });

        it('can transition to ArrangingPayment once Customer and ShippingMethod has been set', async () => {
            const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);

            const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
                id: [eligibleShippingMethods[0].id],
            });
            testOrderGuard.assertSuccess(setOrderShippingMethod);

            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            if (transitionOrderToState) {
                testOrderGuard.assertSuccess(transitionOrderToState);
                expect(pick(transitionOrderToState, ['id', 'state'])).toEqual({
                    id: 'T_1',
                    state: 'ArrangingPayment',
                });
            } else {
                fail('Expected transitionOrderToState to exist');
            }
        });

        it('adds a successful payment and transitions Order state', async () => {
            const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                },
            });
            orderResultGuard.assertSuccess(addPaymentToOrder);

            const payment = addPaymentToOrder.payments![0];
            expect(addPaymentToOrder.state).toBe('PaymentSettled');
            expect(addPaymentToOrder.active).toBe(false);
            expect(addPaymentToOrder.payments!.length).toBe(1);
            expect(payment.method).toBe(testSuccessfulPaymentMethod.code);
            expect(payment.state).toBe('Settled');
        });

        it('activeOrder is null after payment', async () => {
            const result = await shopClient.query(getActiveOrderDocument);

            expect(result.activeOrder).toBeNull();
        });

        it('customer default Addresses are updated after payment', async () => {
            const result = await adminClient.query(getCustomerDocument, {
                id: createdCustomerId,
            });

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const shippingAddress = result.customer!.addresses!.find(a => a.defaultShippingAddress)!;
            expect(shippingAddress.streetLine1).toBe('12 Shipping Street');
            expect(shippingAddress.postalCode).toBe('123456');
            expect(shippingAddress.defaultBillingAddress).toBe(false);
            expect(shippingAddress.defaultShippingAddress).toBe(true);

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const billingAddress = result.customer!.addresses!.find(a => a.defaultBillingAddress)!;
            expect(billingAddress.streetLine1).toBe('22 Billing Avenue');
            expect(billingAddress.postalCode).toBe('123456');
            expect(billingAddress.defaultBillingAddress).toBe(true);
            expect(billingAddress.defaultShippingAddress).toBe(false);
        });

        it('sets OrderLine.featuredAsset to that of ProductVariant if defined', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_4',
            });
            const variantWithFeaturedAsset = product?.variants.find(v => !!v.featuredAsset);
            if (!variantWithFeaturedAsset) {
                fail(`Could not find expected variant with a featuredAsset`);
            }
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantWithFeaturedAsset.id,
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].productVariant.id).toBe(variantWithFeaturedAsset?.id);
            expect(addItemToOrder.lines[0].featuredAsset?.id).toBe(
                variantWithFeaturedAsset.featuredAsset?.id,
            );
        });

        it('sets OrderLine.featuredAsset to that of Product if ProductVariant has no featuredAsset', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_4',
            });
            const variantWithoutFeaturedAsset = product?.variants.find(v => !v.featuredAsset);
            if (!variantWithoutFeaturedAsset) {
                fail(`Could not find expected variant without a featuredAsset`);
            }
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: variantWithoutFeaturedAsset.id,
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(2);
            expect(addItemToOrder.lines[1].productVariant.id).toBe(variantWithoutFeaturedAsset?.id);
            expect(addItemToOrder.lines[1].featuredAsset?.id).toBe(product?.featuredAsset?.id);
        });

        it('adds multiple items to order with different custom fields', async () => {
            await shopClient.asAnonymousUser(); // New order
            const { addItemsToOrder } = await shopClient.query(
                addMultipleItemsToOrderWithCustomFieldsDocument,
                {
                    inputs: [
                        {
                            productVariantId: 'T_1',
                            quantity: 1,
                            customFields: {
                                notes: 'Variant 1 note',
                            },
                        },
                        {
                            productVariantId: 'T_2',
                            quantity: 2,
                            customFields: {
                                notes: 'Variant 2 note',
                            },
                        },
                        {
                            productVariantId: 'T_3',
                            quantity: 3,
                            // no custom field
                        },
                    ],
                },
            );
            const order = addItemsToOrder.order;
            expect(order.lines.length).toBe(3);
            expect(order.lines[0].customFields.notes).toBe('Variant 1 note');
            expect(order.lines[1].quantity).toBe(2);
            expect(order.lines[1].customFields.notes).toBe('Variant 2 note');
            expect(order.lines[2].quantity).toBe(3);
            expect(order.lines[2].customFields.notes).toBeNull();
        });
    });

    describe('ordering as authenticated user', () => {
        let firstOrderLineId: string;
        let activeOrder: FragmentOf<typeof testOrderFragment>;
        let authenticatedUserEmailAddress: string;
        let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];
        const password = 'test';

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            const result = await adminClient.query(getCustomerListDocument, {
                options: {
                    take: 2,
                },
            });
            customers = result.customers.items;
            authenticatedUserEmailAddress = customers[0].emailAddress;
            await shopClient.asUserWithCredentials(authenticatedUserEmailAddress, password);
        });

        it('activeOrder returns null before any items have been added', async () => {
            const result = await shopClient.query(getActiveOrderDocument);
            expect(result.activeOrder).toBeNull();
        });

        it('addItemToOrder creates a new Order with an item', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].quantity).toBe(1);
            expect(addItemToOrder.lines[0].productVariant.id).toBe('T_1');
            activeOrder = addItemToOrder as unknown as FragmentOf<typeof testOrderFragment>;
            firstOrderLineId = addItemToOrder.lines[0].id;
        });

        it('activeOrder returns order after item has been added', async () => {
            const result = await shopClient.query(getActiveOrderDocument);
            expect(result.activeOrder!.id).toBe(activeOrder.id);
            expect(result.activeOrder!.state).toBe('AddingItems');
        });

        it('activeOrder resolves customer user', async () => {
            const result = await shopClient.query(getActiveOrderDocument);
            expect(result.activeOrder!.customer!.user).toEqual({
                id: 'T_2',
                identifier: 'hayden.zieme12@hotmail.com',
            });
        });

        it('addItemToOrder with an existing productVariantId adds quantity to the existing OrderLine', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 2,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].quantity).toBe(3);
        });

        it('adjustOrderLine adjusts the quantity', async () => {
            const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                orderLineId: firstOrderLineId,
                quantity: 50,
            });
            orderResultGuard.assertSuccess(adjustOrderLine);
            expect(adjustOrderLine.lines.length).toBe(1);
            expect(adjustOrderLine.lines[0].quantity).toBe(50);
        });

        it('removeItemFromOrder removes the correct item', async () => {
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_3',
                quantity: 3,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(2);
            expect(addItemToOrder.lines.map(i => i.productVariant.id)).toEqual(['T_1', 'T_3']);

            const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: firstOrderLineId,
            });
            orderResultGuard.assertSuccess(removeOrderLine);
            expect(removeOrderLine.lines.length).toBe(1);
            expect(removeOrderLine.lines.map(i => i.productVariant.id)).toEqual(['T_3']);
        });

        it('nextOrderStates returns next valid states', async () => {
            const result = await shopClient.query(getNextStatesDocument);

            expect(result.nextOrderStates).toEqual(['ArrangingPayment', 'Cancelled']);
        });

        it('logging out and back in again resumes the last active order', async () => {
            await shopClient.asAnonymousUser();
            const result1 = await shopClient.query(getActiveOrderDocument);
            expect(result1.activeOrder).toBeNull();

            await shopClient.asUserWithCredentials(authenticatedUserEmailAddress, password);
            const result2 = await shopClient.query(getActiveOrderDocument);
            expect(result2.activeOrder!.id).toBe(activeOrder.id);
        });

        it('cannot setCustomerForOrder when already logged in', async () => {
            const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: 'newperson@email.com',
                    firstName: 'New',
                    lastName: 'Person',
                },
            });
            setCustomerForOrderGuard.assertErrorResult(setCustomerForOrder);

            expect(setCustomerForOrder.message).toBe(
                'Cannot set a Customer for the Order when already logged in',
            );
            expect(setCustomerForOrder.errorCode).toBe(ErrorCode.ALREADY_LOGGED_IN_ERROR);
        });

        describe('shipping', () => {
            let shippingMethods: ResultOf<
                typeof getEligibleShippingMethodsDocument
            >['eligibleShippingMethods'];

            it(
                'setOrderShippingAddress throws with invalid countryCode',
                assertThrowsWithMessage(() => {
                    const address: CreateAddressInput = {
                        streetLine1: '12 the street',
                        countryCode: 'INVALID',
                    };

                    return shopClient.query(setShippingAddressDocument, {
                        input: address,
                    });
                }, 'The countryCode "INVALID" was not recognized'),
            );

            it('setOrderShippingAddress sets shipping address', async () => {
                const address: CreateAddressInput = {
                    fullName: 'name',
                    company: 'company',
                    streetLine1: '12 the street',
                    streetLine2: null,
                    city: 'foo',
                    province: 'bar',
                    postalCode: '123456',
                    countryCode: 'US',
                    phoneNumber: '4444444',
                };
                const { setOrderShippingAddress } = await shopClient.query(setShippingAddressDocument, {
                    input: address,
                });

                orderResultGuard.assertSuccess(setOrderShippingAddress);

                expect(setOrderShippingAddress.shippingAddress).toEqual({
                    fullName: 'name',
                    company: 'company',
                    streetLine1: '12 the street',
                    streetLine2: null,
                    city: 'foo',
                    province: 'bar',
                    postalCode: '123456',
                    country: 'United States of America',
                    phoneNumber: '4444444',
                });
            });

            it('eligibleShippingMethods lists shipping methods', async () => {
                const result = await shopClient.query(getEligibleShippingMethodsDocument);

                shippingMethods = result.eligibleShippingMethods;

                expect(shippingMethods).toEqual([
                    {
                        id: 'T_1',
                        price: 500,
                        code: 'standard-shipping',
                        name: 'Standard Shipping',
                        description: '',
                    },
                    {
                        id: 'T_2',
                        price: 1000,
                        code: 'express-shipping',
                        name: 'Express Shipping',
                        description: '',
                    },
                    {
                        id: 'T_3',
                        price: 1000,
                        code: 'express-shipping-taxed',
                        name: 'Express Shipping (Taxed)',
                        description: '',
                    },
                ]);
            });

            it('shipping is initially unset', async () => {
                const result = await shopClient.query(getActiveOrderDocument);

                expect(result.activeOrder!.shipping).toEqual(0);
                expect(result.activeOrder!.shippingLines).toEqual([]);
            });

            it('setOrderShippingMethod sets the shipping method', async () => {
                await shopClient.query(setShippingMethodDocument, {
                    id: [shippingMethods[1].id],
                });

                const activeOrderResult = await shopClient.query(getActiveOrderDocument);

                const order = activeOrderResult.activeOrder!;

                expect(order.shipping).toBe(shippingMethods[1].price);
                expect(order.shippingLines[0].shippingMethod.id).toBe(shippingMethods[1].id);
                expect(order.shippingLines[0].shippingMethod.description).toBe(
                    shippingMethods[1].description,
                );
            });

            it('shipping method is preserved after adjustOrderLine', async () => {
                const activeOrderResult = await shopClient.query(getActiveOrderDocument);
                activeOrder = activeOrderResult.activeOrder!;
                const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                    orderLineId: activeOrder.lines[0].id,
                    quantity: 10,
                });
                testOrderGuard.assertSuccess(adjustOrderLine);
                expect(adjustOrderLine.shipping).toBe(shippingMethods[1].price);
                expect(adjustOrderLine.shippingLines[0].shippingMethod.id).toBe(shippingMethods[1].id);
                expect(adjustOrderLine.shippingLines[0].shippingMethod.description).toBe(
                    shippingMethods[1].description,
                );
            });
        });

        describe('payment', () => {
            it('attempting add a Payment returns error result when in AddingItems state', async () => {
                const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                    input: {
                        method: testSuccessfulPaymentMethod.code,
                        metadata: {},
                    },
                });

                testOrderGuard.assertErrorResult(addPaymentToOrder);
                expect(addPaymentToOrder.message).toBe(
                    'A Payment may only be added when Order is in "ArrangingPayment" state',
                );
                expect(addPaymentToOrder.errorCode).toBe(ErrorCode.ORDER_PAYMENT_STATE_ERROR);
            });

            it('transitions to the ArrangingPayment state', async () => {
                const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                    state: 'ArrangingPayment',
                });

                if (transitionOrderToState) {
                    testOrderGuard.assertSuccess(transitionOrderToState);
                    expect(pick(transitionOrderToState, ['id', 'state'])).toEqual({
                        id: activeOrder.id,
                        state: 'ArrangingPayment',
                    });
                } else {
                    fail('Expected transitionOrderToState to exist');
                }
            });

            it('attempting to add an item returns error result when in ArrangingPayment state', async () => {
                const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                    productVariantId: 'T_4',
                    quantity: 1,
                });

                orderResultGuard.assertErrorResult(addItemToOrder);
                expect(addItemToOrder.message).toBe(
                    'Order contents may only be modified when in the "AddingItems" state',
                );
                expect(addItemToOrder.errorCode).toBe(ErrorCode.ORDER_MODIFICATION_ERROR);
            });

            it('attempting to modify item quantity returns error result when in ArrangingPayment state', async () => {
                const { adjustOrderLine } = await shopClient.query(adjustItemQuantityDocument, {
                    orderLineId: activeOrder.lines[0].id,
                    quantity: 12,
                });
                testOrderGuard.assertErrorResult(adjustOrderLine);
                expect(adjustOrderLine.message).toBe(
                    'Order contents may only be modified when in the "AddingItems" state',
                );
                expect(adjustOrderLine.errorCode).toBe(ErrorCode.ORDER_MODIFICATION_ERROR);
            });

            it('attempting to remove an item returns error result when in ArrangingPayment state', async () => {
                const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                    orderLineId: activeOrder.lines[0].id,
                });
                testOrderGuard.assertErrorResult(removeOrderLine);
                expect(removeOrderLine.message).toBe(
                    'Order contents may only be modified when in the "AddingItems" state',
                );
                expect(removeOrderLine.errorCode).toBe(ErrorCode.ORDER_MODIFICATION_ERROR);
            });

            it('attempting to remove all items returns error result when in ArrangingPayment state', async () => {
                const { removeAllOrderLines } = await shopClient.query(removeAllOrderLinesDocument);
                testOrderGuard.assertErrorResult(removeAllOrderLines);
                expect(removeAllOrderLines.message).toBe(
                    'Order contents may only be modified when in the "AddingItems" state',
                );
                expect(removeAllOrderLines.errorCode).toBe(ErrorCode.ORDER_MODIFICATION_ERROR);
            });

            it('attempting to setOrderShippingMethod returns error result when in ArrangingPayment state', async () => {
                const shippingMethodsResult = await shopClient.query(getEligibleShippingMethodsDocument);
                const shippingMethods = shippingMethodsResult.eligibleShippingMethods;
                const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
                    id: [shippingMethods[0].id],
                });
                testOrderGuard.assertErrorResult(setOrderShippingMethod);
                expect(setOrderShippingMethod.message).toBe(
                    'Order contents may only be modified when in the "AddingItems" state',
                );
                expect(setOrderShippingMethod.errorCode).toBe(ErrorCode.ORDER_MODIFICATION_ERROR);
            });

            it('adds a declined payment', async () => {
                const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                    input: {
                        method: testFailingPaymentMethod.code,
                        metadata: {
                            foo: 'bar',
                        },
                    },
                });
                testOrderGuard.assertErrorResult(addPaymentToOrder);

                expect(addPaymentToOrder.message).toBe('The payment was declined');
                expect(addPaymentToOrder.errorCode).toBe(ErrorCode.PAYMENT_DECLINED_ERROR);
                expect((addPaymentToOrder as any).paymentErrorMessage).toBe('Insufficient funds');

                const { activeOrder: order } = await shopClient.query(getActiveOrderWithPaymentsDocument);
                const payment = order!.payments![0];
                expect(order!.state).toBe('ArrangingPayment');
                expect(order!.payments!.length).toBe(1);
                expect(payment.method).toBe(testFailingPaymentMethod.code);
                expect(payment.state).toBe('Declined');
                expect(payment.transactionId).toBe(null);
                expect(payment.metadata).toEqual({
                    public: { foo: 'bar' },
                });
            });

            it('adds an error payment and returns error result', async () => {
                const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                    input: {
                        method: testErrorPaymentMethod.code,
                        metadata: {
                            foo: 'bar',
                        },
                    },
                });

                testOrderGuard.assertErrorResult(addPaymentToOrder);
                expect(addPaymentToOrder.message).toBe('The payment failed');
                expect(addPaymentToOrder.errorCode).toBe(ErrorCode.PAYMENT_FAILED_ERROR);
                expect((addPaymentToOrder as any).paymentErrorMessage).toBe('Something went horribly wrong');

                const result = await shopClient.query(getActiveOrderPaymentsDocument);
                const payment = result.activeOrder!.payments![1];
                expect(result.activeOrder!.payments!.length).toBe(2);
                expect(payment.method).toBe(testErrorPaymentMethod.code);
                expect(payment.state).toBe('Error');
                expect(payment.errorMessage).toBe('Something went horribly wrong');
            });

            it('adds a successful payment and transitions Order state', async () => {
                const { addPaymentToOrder } = await shopClient.query(addPaymentDocument, {
                    input: {
                        method: testSuccessfulPaymentMethod.code,
                        metadata: {
                            baz: 'quux',
                        },
                    },
                });
                orderResultGuard.assertSuccess(addPaymentToOrder);

                const payment = addPaymentToOrder.payments!.find(p => p.transactionId === '12345')!;
                expect(addPaymentToOrder.state).toBe('PaymentSettled');
                expect(addPaymentToOrder.active).toBe(false);
                expect(addPaymentToOrder.payments!.length).toBe(3);
                expect(payment.method).toBe(testSuccessfulPaymentMethod.code);
                expect(payment.state).toBe('Settled');
                expect(payment.transactionId).toBe('12345');
                expect(payment.metadata).toEqual({
                    public: { baz: 'quux' },
                });
            });

            it('does not create new address when Customer already has address', async () => {
                const { customer } = await adminClient.query(getCustomerDocument, { id: customers[0].id });
                expect(customer!.addresses!.length).toBe(1);
            });
        });

        describe('orderByCode', () => {
            describe('immediately after Order is placed', () => {
                it('works when authenticated', async () => {
                    const result = await shopClient.query(getOrderByCodeDocument, {
                        code: activeOrder.code,
                    });

                    expect(result.orderByCode!.id).toBe(activeOrder.id);
                });

                it('works when anonymous', async () => {
                    await shopClient.asAnonymousUser();
                    const result = await shopClient.query(getOrderByCodeDocument, {
                        code: activeOrder.code,
                    });

                    expect(result.orderByCode!.id).toBe(activeOrder.id);
                });

                it(
                    "throws error for another user's Order",
                    assertThrowsWithMessage(async () => {
                        authenticatedUserEmailAddress = customers[1].emailAddress;
                        await shopClient.asUserWithCredentials(authenticatedUserEmailAddress, password);
                        return shopClient.query(getOrderByCodeDocument, {
                            code: activeOrder.code,
                        });
                    }, 'You are not currently authorized to perform this action'),
                );
            });

            describe('3 hours after the Order has been placed', () => {
                let dateNowMock: any;
                beforeAll(() => {
                    // mock Date.now: add 3 hours
                    const nowIn3H = Date.now() + 3 * 3600 * 1000;
                    dateNowMock = vi.spyOn(global.Date, 'now').mockImplementation(() => nowIn3H);
                });

                it('still works when authenticated as owner', async () => {
                    authenticatedUserEmailAddress = customers[0].emailAddress;
                    await shopClient.asUserWithCredentials(authenticatedUserEmailAddress, password);
                    const result = await shopClient.query(getOrderByCodeDocument, {
                        code: activeOrder.code,
                    });

                    expect(result.orderByCode!.id).toBe(activeOrder.id);
                });

                it(
                    'access denied when anonymous',
                    assertThrowsWithMessage(async () => {
                        await shopClient.asAnonymousUser();
                        await shopClient.query(getOrderByCodeDocument, {
                            code: activeOrder.code,
                        });
                    }, 'You are not currently authorized to perform this action'),
                );

                afterAll(() => {
                    // restore Date.now
                    dateNowMock.mockRestore();
                });
            });
        });
    });

    describe('order merging', () => {
        let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

        beforeAll(async () => {
            const result = await adminClient.query(getCustomerListDocument);
            customers = result.customers.items;
        });

        it('merges guest order with no existing order', async () => {
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].productVariant.id).toBe('T_1');

            await shopClient.query(attemptLoginDocument, {
                username: customers[1].emailAddress,
                password: 'test',
            });
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

            expect(activeOrder!.lines.length).toBe(1);
            expect(activeOrder!.lines[0].productVariant.id).toBe('T_1');
        });

        it('merges guest order with existing order', async () => {
            await shopClient.asAnonymousUser();
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_2',
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);
            expect(addItemToOrder.lines.length).toBe(1);
            expect(addItemToOrder.lines[0].productVariant.id).toBe('T_2');

            await shopClient.query(attemptLoginDocument, {
                username: customers[1].emailAddress,
                password: 'test',
            });
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

            expect(activeOrder!.lines.length).toBe(2);
            expect(activeOrder!.lines[0].productVariant.id).toBe('T_1');
            expect(activeOrder!.lines[1].productVariant.id).toBe('T_2');
        });

        /**
         * See https://github.com/vendurehq/vendure/issues/263
         */
        it('does not merge when logging in to a different account (issue #263)', async () => {
            await shopClient.query(attemptLoginDocument, {
                username: customers[2].emailAddress,
                password: 'test',
            });
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

            expect(activeOrder).toBeNull();
        });

        it('does not merge when logging back to other account (issue #263)', async () => {
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_3',
                quantity: 1,
            });

            await shopClient.query(attemptLoginDocument, {
                username: customers[1].emailAddress,
                password: 'test',
            });
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

            expect(activeOrder!.lines.length).toBe(2);
            expect(activeOrder!.lines[0].productVariant.id).toBe('T_1');
            expect(activeOrder!.lines[1].productVariant.id).toBe('T_2');
        });

        // https://github.com/vendurehq/vendure/issues/754
        it('handles merging when an existing order has OrderLines', async () => {
            async function setShippingOnActiveOrder() {
                await shopClient.query(setShippingAddressDocument, {
                    input: {
                        streetLine1: '12 the street',
                        countryCode: 'US',
                    },
                });
                const { eligibleShippingMethods } = await shopClient.query(
                    getEligibleShippingMethodsDocument,
                );
                await shopClient.query(setShippingMethodDocument, {
                    id: [eligibleShippingMethods[1].id],
                });
            }

            // Set up an existing order and add a ShippingLine
            await shopClient.asUserWithCredentials(customers[2].emailAddress, 'test');
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_3',
                quantity: 1,
            });
            await setShippingOnActiveOrder();

            // Now start a new guest order
            await shopClient.query(logOutDocument);
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_4',
                quantity: 1,
            });
            await setShippingOnActiveOrder();

            // attempt to log in and merge the guest order with the existing order
            const { login } = await shopClient.query(attemptLoginDocument, {
                username: customers[2].emailAddress,
                password: 'test',
            });

            currentUserGuard.assertSuccess(login);

            expect(login.identifier).toBe(customers[2].emailAddress);
        });
    });

    describe('security of customer data', () => {
        let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

        beforeAll(async () => {
            const result = await adminClient.query(getCustomerListDocument);
            customers = result.customers.items;
        });

        it('cannot setCustomOrder to existing non-guest Customer', async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: customers[0].emailAddress,
                    firstName: 'Evil',
                    lastName: 'Hacker',
                },
            });
            setCustomerForOrderGuard.assertErrorResult(setCustomerForOrder);

            expect(setCustomerForOrder.message).toBe('The email address is not available.');
            expect(setCustomerForOrder.errorCode).toBe(ErrorCode.EMAIL_ADDRESS_CONFLICT_ERROR);

            const { customer } = await adminClient.query(getCustomerDocument, {
                id: customers[0].id,
            });
            expect(customer!.firstName).not.toBe('Evil');
            expect(customer!.lastName).not.toBe('Hacker');
        });

        it('guest cannot access Addresses of guest customer', async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: 'test@test.com',
                    firstName: 'Evil',
                    lastName: 'Hacker',
                },
            });

            const { activeOrder } = await shopClient.query(getActiveOrderAddressesDocument);

            expect(activeOrder!.customer!.addresses).toEqual([]);
        });

        it('guest cannot access Orders of guest customer', async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });

            await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: 'test@test.com',
                    firstName: 'Evil',
                    lastName: 'Hacker',
                },
            });

            const { activeOrder } = await shopClient.query(getActiveOrderOrdersDocument);

            expect(activeOrder!.customer!.orders.items).toEqual([]);
        });
    });

    describe('order custom fields', () => {
        it('custom fields added to type', async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            const { activeOrder } = await shopClient.query(getOrderCustomFieldsDocument);

            expect(activeOrder?.customFields).toEqual({
                orderImage: null,
                giftWrap: false,
            });
        });

        it('setting order custom fields', async () => {
            const { setOrderCustomFields } = await shopClient.query(setOrderCustomFieldsDocument, {
                input: {
                    customFields: { giftWrap: true, orderImageId: 'T_1' },
                },
            });

            if (!('customFields' in setOrderCustomFields)) {
                fail('Expected setOrderCustomFields to have customFields');
            }

            expect(setOrderCustomFields.customFields).toEqual({
                orderImage: { id: 'T_1' },
                giftWrap: true,
            });

            const { activeOrder } = await shopClient.query(getOrderCustomFieldsDocument);

            expect(activeOrder?.customFields).toEqual({
                orderImage: { id: 'T_1' },
                giftWrap: true,
            });
        });
    });

    describe('remove all order lines', () => {
        beforeAll(async () => {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_2',
                quantity: 3,
            });
        });
        it('should remove all order lines', async () => {
            const { removeAllOrderLines } = await shopClient.query(removeAllOrderLinesDocument);
            orderResultGuard.assertSuccess(removeAllOrderLines);
            expect(removeAllOrderLines?.total).toBe(0);
            expect(removeAllOrderLines?.lines.length).toBe(0);
        });
    });

    describe('validation of product variant availability', () => {
        const bonsaiProductId = 'T_20';
        const bonsaiVariantId = 'T_34';

        beforeAll(async () => {
            await shopClient.asAnonymousUser();
        });

        it(
            'addItemToOrder errors when product is disabled',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: bonsaiProductId,
                        enabled: false,
                    },
                });

                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: bonsaiVariantId,
                    quantity: 1,
                });
            }, 'No ProductVariant with the id "34" could be found'),
        );

        it(
            'addItemToOrder errors when product variant is disabled',
            assertThrowsWithMessage(async () => {
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: bonsaiProductId,
                        enabled: true,
                    },
                });
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: bonsaiVariantId,
                            enabled: false,
                        },
                    ],
                });

                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: bonsaiVariantId,
                    quantity: 1,
                });
            }, 'No ProductVariant with the id "34" could be found'),
        );
        it(
            'addItemToOrder errors when product is deleted',
            assertThrowsWithMessage(async () => {
                await adminClient.query(deleteProductDocument, {
                    id: bonsaiProductId,
                });

                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: bonsaiVariantId,
                    quantity: 1,
                });
            }, 'No ProductVariant with the id "34" could be found'),
        );
        it(
            'addItemToOrder errors when product variant is deleted',
            assertThrowsWithMessage(async () => {
                await adminClient.query(deleteProductVariantDocument, {
                    id: bonsaiVariantId,
                });

                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: bonsaiVariantId,
                    quantity: 1,
                });
            }, 'No ProductVariant with the id "34" could be found'),
        );

        let orderWithDeletedProductVariantId: string;
        it('errors when transitioning to ArrangingPayment with deleted variant', async () => {
            const orchidProductId = 'T_19';
            const orchidVariantId = 'T_33';

            await shopClient.asUserWithCredentials('marques.sawayn@hotmail.com', 'test');
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: orchidVariantId,
                quantity: 1,
            });

            orderResultGuard.assertSuccess(addItemToOrder);
            orderWithDeletedProductVariantId = addItemToOrder.id;

            await adminClient.query(deleteProductDocument, {
                id: orchidProductId,
            });

            const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
                state: 'ArrangingPayment',
            });
            if (transitionOrderToState) {
                testOrderGuard.assertErrorResult(transitionOrderToState);
                expect(transitionOrderToState.transitionError).toBe(
                    'Cannot transition to "ArrangingPayment" because the Order contains ProductVariants which are no longer available',
                );
            } else {
                fail('Expected transitionOrderToState to exist');
            }
            expect(transitionOrderToState.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
        });

        // https://github.com/vendurehq/vendure/issues/1567
        it('allows transitioning to Cancelled with deleted variant', async () => {
            const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
                input: {
                    orderId: orderWithDeletedProductVariantId,
                },
            });

            orderResultGuard.assertSuccess(cancelOrder);

            expect(cancelOrder.state).toBe('Cancelled');
        });
    });

    // https://github.com/vendurehq/vendure/issues/1195
    describe('shipping method invalidation', () => {
        let GBShippingMethodId: string;
        let ATShippingMethodId: string;

        beforeAll(async () => {
            // First we will remove all ShippingMethods and set up 2 specialized ones
            const { shippingMethods } = await adminClient.query(getShippingMethodListDocument);
            for (const method of shippingMethods.items) {
                await adminClient.query(deleteShippingMethodDocument, {
                    id: method.id,
                });
            }

            function createCountryCodeShippingMethodInput(countryCode: string): CreateShippingMethodInput {
                return {
                    code: `${countryCode}-shipping`,
                    translations: [
                        { languageCode: LanguageCode.en, name: `${countryCode} shipping`, description: '' },
                    ],
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: countryCodeShippingEligibilityChecker.code,
                        arguments: [{ name: 'countryCode', value: countryCode }],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '1000' },
                            { name: 'taxRate', value: '0' },
                            { name: 'includesTax', value: 'auto' },
                        ],
                    },
                };
            }

            // Now create 2 shipping methods, valid only for a single country
            const result1 = await adminClient.query(createShippingMethodDocument, {
                input: createCountryCodeShippingMethodInput('GB'),
            });
            GBShippingMethodId = result1.createShippingMethod.id;
            const result2 = await adminClient.query(createShippingMethodDocument, {
                input: createCountryCodeShippingMethodInput('AT'),
            });
            ATShippingMethodId = result2.createShippingMethod.id;

            // Now create an order to GB and set the GB shipping method
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(setCustomerDocument, {
                input: {
                    emailAddress: 'test-2@test.com',
                    firstName: 'Test',
                    lastName: 'Person 2',
                },
            });
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    streetLine1: '12 the street',
                    countryCode: 'GB',
                },
            });
            await shopClient.query(setShippingMethodDocument, {
                id: [GBShippingMethodId],
            });
        });

        it('if selected method no longer eligible, next best is set automatically', async () => {
            const result1 = await shopClient.query(getActiveOrderDocument);
            expect(result1.activeOrder?.shippingLines[0].shippingMethod.id).toBe(GBShippingMethodId);

            await shopClient.query(setShippingAddressDocument, {
                input: {
                    streetLine1: '12 the street',
                    countryCode: 'AT',
                },
            });

            const result2 = await shopClient.query(getActiveOrderDocument);
            expect(result2.activeOrder?.shippingLines[0].shippingMethod.id).toBe(ATShippingMethodId);
        });

        it('if no method is eligible, shipping lines are cleared', async () => {
            await shopClient.query(setShippingAddressDocument, {
                input: {
                    streetLine1: '12 the street',
                    countryCode: 'US',
                },
            });

            const result = await shopClient.query(getActiveOrderDocument);
            expect(result.activeOrder?.shippingLines).toEqual([]);
        });

        // https://github.com/vendurehq/vendure/issues/1441
        it('shipping methods are re-evaluated when all OrderLines are removed', async () => {
            const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
                input: {
                    code: 'min-price-shipping',
                    translations: [
                        { languageCode: LanguageCode.en, name: 'min price shipping', description: '' },
                    ],
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [{ name: 'orderMinimum', value: '100' }],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '1000' },
                            { name: 'taxRate', value: '0' },
                            { name: 'includesTax', value: 'auto' },
                        ],
                    },
                },
            });
            const minPriceShippingMethodId = createShippingMethod.id;

            await shopClient.query(setShippingMethodDocument, {
                id: [minPriceShippingMethodId],
            });
            const result1 = await shopClient.query(getActiveOrderDocument);
            expect(result1.activeOrder?.shippingLines[0].shippingMethod.id).toBe(minPriceShippingMethodId);

            const { removeAllOrderLines } = await shopClient.query(removeAllOrderLinesDocument);
            orderResultGuard.assertSuccess(removeAllOrderLines);
            expect(removeAllOrderLines.shippingLines.length).toBe(0);
            expect(removeAllOrderLines.shippingWithTax).toBe(0);
        });
    });

    describe('edge cases', () => {
        it('calling setShippingMethod and setBillingMethod in parallel does not introduce race condition', async () => {
            const shippingAddress: CreateAddressInput = {
                fullName: 'name',
                company: 'company',
                streetLine1: '12 Shipping Street',
                streetLine2: null,
                city: 'foo',
                province: 'bar',
                postalCode: '123456',
                countryCode: 'US',
                phoneNumber: '4444444',
            };
            const billingAddress: CreateAddressInput = {
                fullName: 'name',
                company: 'company',
                streetLine1: '22 Billing Avenue',
                streetLine2: null,
                city: 'foo',
                province: 'bar',
                postalCode: '123456',
                countryCode: 'US',
                phoneNumber: '4444444',
            };

            await Promise.all([
                shopClient.query(setBillingAddressDocument, {
                    input: billingAddress,
                }),
                shopClient.query(setShippingAddressDocument, {
                    input: shippingAddress,
                }),
            ]);

            const { activeOrder } = await shopClient.query(getActiveOrderShippingBillingDocument);
            activeOrderGuard.assertSuccess(activeOrder);

            expect(activeOrder.shippingAddress).toEqual(shippingAddress);
            expect(activeOrder.billingAddress).toEqual(billingAddress);
        });

        // https://github.com/vendurehq/vendure/issues/2548
        it('hydrating Order in the ShippingEligibilityChecker does not break order modification', async () => {
            // First we'll create a ShippingMethod that uses the hydrating checker
            await adminClient.query(createShippingMethodDocument, {
                input: {
                    code: 'hydrating-checker',
                    translations: [
                        { languageCode: LanguageCode.en, name: 'hydrating checker', description: '' },
                    ],
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: hydratingShippingEligibilityChecker.code,
                        arguments: [],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '1000' },
                            { name: 'taxRate', value: '0' },
                            { name: 'includesTax', value: 'auto' },
                        ],
                    },
                },
            });

            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_2',
                quantity: 3,
            });

            const result1 = await shopClient.query(getActiveOrderDocument);

            expect(result1.activeOrder?.lines.map(l => l.linePriceWithTax).sort()).toEqual([155880, 503640]);
            expect(result1.activeOrder?.subTotalWithTax).toBe(659520);

            // set the shipping method that uses the hydrating checker
            const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);
            const { setOrderShippingMethod } = await shopClient.query(setShippingMethodDocument, {
                id: [eligibleShippingMethods.find(m => m.code === 'hydrating-checker')!.id],
            });
            orderResultGuard.assertSuccess(setOrderShippingMethod);

            // Remove an item from the order
            const { removeOrderLine } = await shopClient.query(removeItemFromOrderDocument, {
                orderLineId: result1.activeOrder!.lines[0].id,
            });
            orderResultGuard.assertSuccess(removeOrderLine);
            expect(removeOrderLine.lines.length).toBe(1);

            const result2 = await shopClient.query(getActiveOrderDocument);

            expect(result2.activeOrder?.lines.map(l => l.linePriceWithTax).sort()).toEqual([503640]);
            expect(result2.activeOrder?.subTotalWithTax).toBe(503640);
        });
    });
});
