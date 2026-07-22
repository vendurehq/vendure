/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode } from '@vendure/common/lib/generated-shop-types';
import {
    configureDefaultOrderProcess,
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    freeShipping,
    LanguageCode,
    manualFulfillmentHandler,
    mergeConfig,
    minimumOrderAmount,
    NoOrderRecalculationStrategy,
    orderPercentageDiscount,
    TtlOrderRecalculationStrategy,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createPromotionDocument,
    createShippingMethodDocument,
    deletePromotionDocument,
    updateProductVariantsDocument,
    updatePromotionDocument,
    updateShippingMethodDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderDocument,
    getActiveOrderWithPriceDataDocument,
    setCustomerDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    transitionToStateDocument,
} from './graphql/shop-definitions';

describe('OrderRecalculationStrategy', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderRecalculationStrategy: new TtlOrderRecalculationStrategy({ ttlMs: 0 }),
            },
        }),
    );

    const orderResultGuard: ErrorResultGuard<{ id: string; totalWithTax: number }> = createErrorResultGuard(
        (input: any) => !!input.lines,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3510 — active order recalculates variant price change on read when strategy reports stale
    it('recalculates changed variant price on read', async () => {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);
        const originalTotal = (addItemToOrder as any).totalWithTax;

        // Admin changes the variant price.
        await adminClient.query(updateProductVariantsDocument, {
            input: [{ id: 'T_1', price: originalTotal * 2 }],
        });

        // Reading the active order triggers a recalculation (ttlMs: 0 => always stale).
        // New price = originalTotal * 2 (base price). Tax 20% applied on top.
        // expectedTotal = originalTotal * 2 * 1.2 = originalTotal * 2.4
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        const expectedTotal = Math.round(originalTotal * 2 * 1.2);
        expect(activeOrder!.totalWithTax).toBe(expectedTotal);
    });

    // #3510 — promotion discount is removed when promotion is deactivated and order is read with TTL(0) strategy
    it('removes promotion discount on read after promotion is deactivated', async () => {
        await shopClient.asAnonymousUser();

        // Create a promotion: 50% off any order
        const { createPromotion } = await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                translations: [{ languageCode: LanguageCode.en, name: '50% off all orders' }],
                conditions: [
                    {
                        code: minimumOrderAmount.code,
                        arguments: [
                            { name: 'amount', value: '0' },
                            { name: 'taxInclusive', value: 'true' },
                        ],
                    },
                ],
                actions: [
                    {
                        code: orderPercentageDiscount.code,
                        arguments: [{ name: 'discount', value: '50' }],
                    },
                ],
            },
        });
        const promotion = createPromotion as { id: string };

        // Add item to order — discount should apply immediately.
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);
        const discountedTotal = (addItemToOrder as any).totalWithTax;
        const discounts = (addItemToOrder as any).discounts as Array<{ description: string }>;
        expect(discounts.some((d: any) => d.description === '50% off all orders')).toBe(true);

        // Admin deactivates the promotion.
        await adminClient.query(updatePromotionDocument, {
            input: { id: promotion.id, enabled: false },
        });

        // Reading the active order with TTL(0) triggers recalculation — discount should be gone.
        // expectedUndiscountedTotal = discountedTotal * 2 (50% off means discounted = half of full price)
        const { activeOrder } = await shopClient.query(getActiveOrderDocument);
        expect(activeOrder!.discounts.length).toBe(0);
        expect(activeOrder!.totalWithTax).toBe(discountedTotal * 2);

        // Cleanup
        await adminClient.query(deletePromotionDocument, { id: promotion.id });
    });
});

// #3510 — default strategy must not recalculate on read (backward compatibility)
describe('OrderRecalculationStrategy — default (NoOrderRecalculationStrategy)', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderRecalculationStrategy: new NoOrderRecalculationStrategy(),
            },
        }),
    );

    const orderResultGuard: ErrorResultGuard<{ id: string; totalWithTax: number }> = createErrorResultGuard(
        (input: any) => !!input.lines,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3510 — default strategy must not recalculate on read (backward compatibility)
    it('does NOT recalculate on read with the default strategy', async () => {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);
        const originalTotal = (addItemToOrder as any).totalWithTax;

        // Admin changes the variant price.
        await adminClient.query(updateProductVariantsDocument, {
            input: [{ id: 'T_1', price: originalTotal * 2 }],
        });

        // Reading the active order should NOT recalculate — total stays the same.
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        expect(activeOrder!.totalWithTax).toBe(originalTotal);
    });
});

// #3510 — checkout gate: verify shipping eligibility + recalc on ArrangingPayment transition
describe('OrderRecalculationStrategy — checkout gate', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderRecalculationStrategy: new TtlOrderRecalculationStrategy({ ttlMs: 0 }),
            },
            shippingOptions: {
                shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
                shippingCalculators: [defaultShippingCalculator],
            },
        }),
    );

    const orderResultGuard: ErrorResultGuard<{ id: string; totalWithTax: number }> = createErrorResultGuard(
        (input: any) => !!input.lines,
    );

    const transitionGuard: ErrorResultGuard<{ state: string }> = createErrorResultGuard(
        (input: any) => !!input.state,
    );

    const shippingAddress = {
        fullName: 'Test Customer',
        streetLine1: '1 Test Street',
        city: 'Test City',
        province: 'Test',
        postalCode: '12345',
        countryCode: 'US',
        phoneNumber: '555-0100',
    };

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3510 — checkout refused when chosen shipping method became ineligible
    it('refuses ArrangingPayment when chosen shipping method is ineligible', async () => {
        await shopClient.asAnonymousUser();

        // Create a shipping method eligible for any order (orderMinimum: 0).
        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'test-ineligible-shipping',
                translations: [{ languageCode: LanguageCode.en, name: 'Test Shipping', description: '' }],
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '500' },
                        { name: 'taxRate', value: '0' },
                        { name: 'includesTax', value: 'auto' },
                    ],
                },
            },
        });
        const shippingMethodId = (createShippingMethod as any).id;

        // Add item to order.
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);

        // Set customer details and shipping.
        await shopClient.query(setCustomerDocument, {
            input: { firstName: 'Test', lastName: 'User', emailAddress: 'test@test.com' },
        });
        await shopClient.query(setShippingAddressDocument, { input: shippingAddress });
        await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });

        // Admin raises the minimum so the current order total no longer qualifies.
        await adminClient.query(updateShippingMethodDocument, {
            input: {
                id: shippingMethodId,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '999999999' }],
                },
                translations: [{ languageCode: LanguageCode.en, name: 'Test Shipping', description: '' }],
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '500' },
                        { name: 'taxRate', value: '0' },
                        { name: 'includesTax', value: 'auto' },
                    ],
                },
            },
        });

        // Transition should be refused: the shipping method is no longer eligible.
        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        transitionGuard.assertErrorResult(transitionOrderToState);
        const transitionError = transitionOrderToState as any;
        expect(transitionError.errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
        expect(transitionError.transitionError).toContain('no longer eligible');
        expect(transitionError.fromState).toBe('AddingItems');
        expect(transitionError.toState).toBe('ArrangingPayment');
    });

    // #3510 — happy path: price is recalculated when transitioning to ArrangingPayment
    it('recalculates prices and allows transition when shipping method is eligible', async () => {
        await shopClient.asAnonymousUser();

        // Create a shipping method eligible for any order.
        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'test-eligible-shipping',
                translations: [
                    { languageCode: LanguageCode.en, name: 'Test Eligible Shipping', description: '' },
                ],
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '500' },
                        { name: 'taxRate', value: '0' },
                        { name: 'includesTax', value: 'auto' },
                    ],
                },
            },
        });
        const shippingMethodId = (createShippingMethod as any).id;

        // Add item to order and record the current total.
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_2',
            quantity: 1,
        });
        orderResultGuard.assertSuccess(addItemToOrder);
        const originalTotal = (addItemToOrder as any).totalWithTax;

        // Set customer details and shipping.
        await shopClient.query(setCustomerDocument, {
            input: { firstName: 'Test', lastName: 'User', emailAddress: 'test2@test.com' },
        });
        await shopClient.query(setShippingAddressDocument, { input: shippingAddress });
        await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });

        // Admin changes the variant price — should be picked up at checkout.
        await adminClient.query(updateProductVariantsDocument, {
            input: [{ id: 'T_2', price: 99999 }],
        });

        // Transition should succeed and order total should reflect the new price.
        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        transitionGuard.assertSuccess(transitionOrderToState);
        expect((transitionOrderToState as any).state).toBe('ArrangingPayment');

        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        // New list price: 99999 cents. Tax 20% → item totalWithTax = Math.round(99999 * 1.2) = 119999.
        // Shipping rate: 500 cents, taxRate: 0 → shippingWithTax = 500.
        // Expected total = 119999 + 500 = 120499.
        const expectedNewItemWithTax = Math.round(99999 * 1.2);
        const expectedShippingWithTax = 500;
        expect(activeOrder!.totalWithTax).toBe(expectedNewItemWithTax + expectedShippingWithTax);
    });
});

const getActiveOrderShippingDocument = gql`
    query GetActiveOrderShipping {
        activeOrder {
            id
            shippingWithTax
            shippingLines {
                shippingMethod {
                    code
                }
            }
            discounts {
                description
            }
            promotions {
                name
            }
        }
    }
`;

const flatRateCalculator = {
    code: defaultShippingCalculator.code,
    arguments: [
        { name: 'rate', value: '500' },
        { name: 'taxRate', value: '0' },
        { name: 'includesTax', value: 'auto' },
    ],
};

const shippingAddressInput = {
    fullName: 'Test Customer',
    streetLine1: '1 Test Street',
    city: 'Test City',
    province: 'Test',
    postalCode: '12345',
    countryCode: 'US',
    phoneNumber: '555-0100',
};

// #3510 — read-time recalc skips applyShippingPromotions, so shipping adjustments are never cleared
describe('OrderRecalculationStrategy — shipping promotions on read', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderRecalculationStrategy: new TtlOrderRecalculationStrategy({ ttlMs: 0 }),
            },
            shippingOptions: {
                shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
                shippingCalculators: [defaultShippingCalculator],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3510 — a disabled free-shipping promotion must not keep discounting shipping on read
    it('clears shipping discounts on read after a shipping promotion is disabled', async () => {
        await shopClient.asAnonymousUser();

        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'flat-rate-shipping',
                translations: [{ languageCode: LanguageCode.en, name: 'Flat rate', description: '' }],
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: flatRateCalculator,
            },
        });
        const shippingMethodId = (createShippingMethod as any).id;

        const { createPromotion } = await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                translations: [{ languageCode: LanguageCode.en, name: 'Free shipping' }],
                conditions: [
                    {
                        code: minimumOrderAmount.code,
                        arguments: [
                            { name: 'amount', value: '0' },
                            { name: 'taxInclusive', value: 'true' },
                        ],
                    },
                ],
                actions: [{ code: freeShipping.code, arguments: [] }],
            },
        });
        const promotionId = (createPromotion as any).id;

        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(setShippingAddressDocument, { input: shippingAddressInput });
        await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });

        const before = await shopClient.query(getActiveOrderShippingDocument);
        expect(before.activeOrder.shippingWithTax).toBe(0);
        expect(before.activeOrder.promotions.map((p: any) => p.name)).toEqual(['Free shipping']);

        // Admin disables the free-shipping promotion.
        await adminClient.query(updatePromotionDocument, {
            input: { id: promotionId, enabled: false },
        });

        // Reading the active order with TTL(0) recalculates — the shipping discount must be gone.
        const after = await shopClient.query(getActiveOrderShippingDocument);
        expect(after.activeOrder.promotions).toEqual([]);
        expect(after.activeOrder.discounts).toEqual([]);
        expect(after.activeOrder.shippingWithTax).toBe(500);

        await adminClient.query(deletePromotionDocument, { id: promotionId });
    });
});

// #3510 — the checkout gate must catch a method made ineligible by the checkout recalculation itself
describe('OrderRecalculationStrategy — checkout gate with default strategy', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderRecalculationStrategy: new NoOrderRecalculationStrategy(),
            },
            shippingOptions: {
                shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
                shippingCalculators: [defaultShippingCalculator],
            },
        }),
    );

    const transitionGuard: ErrorResultGuard<{ state: string }> = createErrorResultGuard(
        (input: any) => !!input.state,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3510 — a price drop that makes the chosen method ineligible must refuse, not silently swap
    it('refuses ArrangingPayment when the checkout recalculation makes the method ineligible', async () => {
        await shopClient.asAnonymousUser();

        // Only eligible while the order total stays above 100000.
        const { createShippingMethod } = await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'premium-shipping',
                translations: [{ languageCode: LanguageCode.en, name: 'Premium', description: '' }],
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '100000' }],
                },
                calculator: flatRateCalculator,
            },
        });
        const shippingMethodId = (createShippingMethod as any).id;

        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(setCustomerDocument, {
            input: { firstName: 'Test', lastName: 'User', emailAddress: 'swap@test.com' },
        });
        await shopClient.query(setShippingAddressDocument, { input: shippingAddressInput });
        await shopClient.query(setShippingMethodDocument, { id: [shippingMethodId] });

        // Admin slashes the price. With the default strategy there is no read-time recalc, so the
        // persisted Order still holds the stale (high) totals when the checkout gate runs.
        await adminClient.query(updateProductVariantsDocument, { input: [{ id: 'T_1', price: 100 }] });

        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });

        transitionGuard.assertErrorResult(transitionOrderToState);
        expect((transitionOrderToState as any).errorCode).toBe(ErrorCode.ORDER_STATE_TRANSITION_ERROR);
        expect((transitionOrderToState as any).transitionError).toContain('no longer eligible');

        // The customer's chosen method must never be changed behind their back.
        const { activeOrder } = await shopClient.query(getActiveOrderShippingDocument);
        expect(activeOrder.shippingLines[0].shippingMethod.code).toBe('premium-shipping');
    });
});

// #3510 — the pre-payment recalculation must key off the ArrangingPayment transition, not shipping
// presence, so a shipping-less checkout also gets fresh prices before payment.
describe('OrderRecalculationStrategy — checkout recalc without shipping', () => {
    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                // No read-time recalc, so the checkout transition is the only place prices refresh.
                orderRecalculationStrategy: new NoOrderRecalculationStrategy(),
                // Allow transitioning to payment without a shipping method.
                process: [configureDefaultOrderProcess({ arrangingPaymentRequiresShipping: false })],
            },
        }),
    );

    const transitionGuard: ErrorResultGuard<{ state: string }> = createErrorResultGuard(
        (input: any) => !!input.state,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3510 — an order with no shipping method still recalculates prices at checkout
    it('recalculates prices at checkout for an order with no shipping method', async () => {
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(setCustomerDocument, {
            input: { firstName: 'No', lastName: 'Ship', emailAddress: 'noship@test.com' },
        });

        // Admin drops the price. With the default strategy there is no read-time recalc, so the
        // persisted order still holds the stale price until the checkout transition recalculates.
        await adminClient.query(updateProductVariantsDocument, { input: [{ id: 'T_1', price: 100 }] });

        const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
            state: 'ArrangingPayment',
        });
        transitionGuard.assertSuccess(transitionOrderToState);
        expect((transitionOrderToState as any).state).toBe('ArrangingPayment');

        // New list price 100 + 20% tax = 120, and no shipping line.
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        expect(activeOrder!.totalWithTax).toBe(Math.round(100 * 1.2));
    });
});
