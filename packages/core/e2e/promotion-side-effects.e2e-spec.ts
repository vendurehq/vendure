// Related fix: runPromotionSideEffects must be called BEFORE the
// OrderLine save in both order.service.ts (applyPriceAdjustments)
// and order-modifier.ts (modifyOrder) so that in-memory changes
// made by side effects are included in the save.
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    manualFulfillmentHandler,
    mergeConfig,
    OrderLine,
    PromotionItemAction,
    TransactionalConnection,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import {
    adminTransitionToStateDocument,
    createPromotionDocument,
    createShippingMethodDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    applyCouponCodeDocument,
    removeCouponCodeDocument,
} from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

let connection: TransactionalConnection;

// Side effect modifies customFields in-place without explicit save.
const sideEffectNoSaveAction = new PromotionItemAction({
    code: 'side_effect_no_save',
    description: [{ languageCode: LanguageCode.en, value: 'Side effect (no save)' }],
    args: {},
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },
    execute(ctx, orderLine, args) {
        return -100;
    },
    onActivate: (ctx, order, args, promotion) => {
        for (const line of order.lines) {
            (line.customFields as any).promoTag = 'activated';
        }
    },
    onDeactivate: (ctx, order, args, promotion) => {
        for (const line of order.lines) {
            (line.customFields as any).promoTag = 'deactivated';
        }
    },
});

// Side effect explicitly saves to DB using injected connection.
const sideEffectWithSaveAction = new PromotionItemAction({
    code: 'side_effect_with_save',
    description: [{ languageCode: LanguageCode.en, value: 'Side effect (with save)' }],
    args: {},
    init(injector) {
        connection = injector.get(TransactionalConnection);
    },
    execute(ctx, orderLine, args) {
        return -100;
    },
    onActivate: async (ctx, order, args, promotion) => {
        for (const line of order.lines) {
            (line.customFields as any).promoTag = 'activated';
        }
        await connection.getRepository(ctx, OrderLine).save(order.lines, { reload: false });
    },
    onDeactivate: async (ctx, order, args, promotion) => {
        for (const line of order.lines) {
            (line.customFields as any).promoTag = 'deactivated';
        }
        await connection.getRepository(ctx, OrderLine).save(order.lines, { reload: false });
    },
});

const customConfig = mergeConfig(testConfig(), {
    paymentOptions: {
        paymentMethodHandlers: [testSuccessfulPaymentMethod],
    },
    promotionOptions: {
        promotionActions: [sideEffectNoSaveAction, sideEffectWithSaveAction],
    },
    customFields: {
        OrderLine: [{ name: 'promoTag', type: 'string', nullable: true, public: true }],
    },
});

const modifyOrderPromoSideEffectsDocument = adminGraphql(`
    mutation ModifyOrderPromoSideEffects($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            ... on Order {
                id
                state
                lines {
                    id
                    quantity
                }
                modifications {
                    id
                    priceChange
                }
                promotions {
                    id
                    couponCode
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

function internalId(externalId: string): number {
    return +externalId.replace('T_', '');
}

async function getOrderLineFromDb(lineId: number) {
    return connection.rawConnection.getRepository(OrderLine).findOneOrFail({ where: { id: lineId } });
}

// https://github.com/vendurehq/vendure/issues/3296
describe('Promotion side effects on OrderLine customFields', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(customConfig);

    const orderResultGuard: ErrorResultGuard<{ lines: any[] }> = createErrorResultGuard(
        input => !!input.lines,
    );
    const orderGuard: ErrorResultGuard<{ id: string }> = createErrorResultGuard(input => !!input.id);

    const COUPON_NO_SAVE = 'NO_SAVE_TEST';
    const COUPON_WITH_SAVE = 'WITH_SAVE_TEST';

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
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-promotions.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();

        // Create a shipping method (needed for checkout flow)
        await adminClient.query(createShippingMethodDocument, {
            input: {
                code: 'test-shipping',
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [
                        { name: 'rate', value: '500' },
                        { name: 'includesTax', value: 'auto' },
                        { name: 'taxRate', value: '0' },
                    ],
                },
                translations: [{ languageCode: LanguageCode.en, name: 'test shipping', description: '' }],
            },
        });

        await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: COUPON_NO_SAVE,
                conditions: [],
                actions: [{ code: sideEffectNoSaveAction.code, arguments: [] }],
                translations: [{ languageCode: LanguageCode.en, name: 'No-save side effect promo' }],
            },
        });

        await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: COUPON_WITH_SAVE,
                conditions: [],
                actions: [{ code: sideEffectWithSaveAction.code, arguments: [] }],
                translations: [{ languageCode: LanguageCode.en, name: 'With-save side effect promo' }],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // ─── applyCouponCode / removeCouponCode path (order.service.ts) ───

    describe('without explicit save in side effect', () => {
        let noSaveLineId: string;

        it('onActivate persists customField changes', async () => {
            await shopClient.asAnonymousUser();

            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });

            const { applyCouponCode } = await shopClient.query(applyCouponCodeDocument, {
                couponCode: COUPON_NO_SAVE,
            });
            orderResultGuard.assertSuccess(applyCouponCode);
            noSaveLineId = applyCouponCode.lines[0].id;

            const orderLine = await getOrderLineFromDb(internalId(noSaveLineId));
            expect((orderLine.customFields as any).promoTag).toBe('activated');
        });

        it('onDeactivate persists customField changes', async () => {
            await shopClient.query(removeCouponCodeDocument, { couponCode: COUPON_NO_SAVE });

            const orderLine = await getOrderLineFromDb(internalId(noSaveLineId));
            expect((orderLine.customFields as any).promoTag).toBe('deactivated');
        });
    });

    describe('with explicit save in side effect', () => {
        let withSaveLineId: string;

        it('onActivate persists customField changes', async () => {
            await shopClient.asAnonymousUser();

            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });

            const { applyCouponCode } = await shopClient.query(applyCouponCodeDocument, {
                couponCode: COUPON_WITH_SAVE,
            });
            orderResultGuard.assertSuccess(applyCouponCode);
            withSaveLineId = applyCouponCode.lines[0].id;

            const orderLine = await getOrderLineFromDb(internalId(withSaveLineId));
            expect((orderLine.customFields as any).promoTag).toBe('activated');
        });

        it('onDeactivate persists customField changes', async () => {
            await shopClient.query(removeCouponCodeDocument, { couponCode: COUPON_WITH_SAVE });

            const orderLine = await getOrderLineFromDb(internalId(withSaveLineId));
            expect((orderLine.customFields as any).promoTag).toBe('deactivated');
        });
    });

    // ─── modifyOrder path (order-modifier.ts) ───

    describe('modifyOrder path', () => {
        let placedOrderId: string;
        let orderLineId: string;

        beforeAll(async () => {
            // Create and place an order with the coupon applied
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });

            const { applyCouponCode } = await shopClient.query(applyCouponCodeDocument, {
                couponCode: COUPON_NO_SAVE,
            });
            orderResultGuard.assertSuccess(applyCouponCode);
            orderLineId = applyCouponCode.lines[0].id;

            // Verify onActivate ran
            const line = await getOrderLineFromDb(internalId(orderLineId));
            expect((line.customFields as any).promoTag).toBe('activated');

            // Complete checkout
            await proceedToArrangingPayment(shopClient);
            const result = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
            orderGuard.assertSuccess(result);
            placedOrderId = result.id;
        });

        it('onDeactivate persists customField changes when coupon removed via modifyOrder', async () => {
            // Transition to Modifying state
            const { transitionOrderToState } = await adminClient.query(adminTransitionToStateDocument, {
                id: placedOrderId,
                state: 'Modifying',
            });
            orderGuard.assertSuccess(transitionOrderToState);

            // Modify the order: remove the coupon code
            const { modifyOrder } = await adminClient.query(modifyOrderPromoSideEffectsDocument, {
                input: {
                    dryRun: false,
                    orderId: placedOrderId,
                    couponCodes: [],
                    refund: {
                        paymentId: 'T_1',
                        reason: 'test',
                    },
                },
            });
            orderGuard.assertSuccess(modifyOrder);

            // Verify the side effect's customField change was persisted
            const orderLine = await getOrderLineFromDb(internalId(orderLineId));
            expect((orderLine.customFields as any).promoTag).toBe('deactivated');
        });
    });
});
