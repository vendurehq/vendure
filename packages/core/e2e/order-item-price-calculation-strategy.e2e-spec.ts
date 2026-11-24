import { LanguageCode } from '@vendure/common/lib/generated-types';
import { mergeConfig, RoundPerUnitMoneyStrategy } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { TestOrderItemPriceCalculationStrategy } from './fixtures/test-order-item-price-calculation-strategy';
import { singleStageRefundablePaymentMethod } from './fixtures/test-payment-methods';
import { FragmentOf } from './graphql/graphql-shop';
import {
    cancelOrderDocument,
    createPromotionDocument,
    getProductWithVariantsDocument,
    refundOrderDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderCustomFieldsDocument,
    adjustOrderLineCustomFieldsDocument,
    applyCouponCodeDocument,
    getActiveOrderWithPriceDataDocument,
    orderWithLinesAndItemsFragment,
} from './graphql/shop-definitions';

import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

class ThreeDecimalMoneyStrategy extends RoundPerUnitMoneyStrategy {
    readonly precision = 3;
}

describe('custom OrderItemPriceCalculationStrategy', () => {
    let variantId: string;
    let variantPrice: number;
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            entityOptions: { moneyStrategy: new ThreeDecimalMoneyStrategy() },
            paymentOptions: { paymentMethodHandlers: [singleStageRefundablePaymentMethod] },
            customFields: {
                OrderLine: [{ name: 'giftWrap', type: 'boolean' }],
            },
            orderOptions: {
                orderItemPriceCalculationStrategy: new TestOrderItemPriceCalculationStrategy(),
            },
        }),
    );

    type OrderWithLinesAndItems = FragmentOf<typeof orderWithLinesAndItemsFragment>;
    const orderGuard: ErrorResultGuard<OrderWithLinesAndItems> = createErrorResultGuard(
        input => !!input.lines,
    );

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
        // Don't read prices via the `search` query here: the index may still be filling.
        const { product } = await adminClient.query(getProductWithVariantsDocument, { id: 'T_1' });
        const variant = product?.variants[0];
        if (!variant) {
            throw new Error('Could not find a product variant for test setup');
        }
        variantId = variant.id;
        // `unitPrice` is the net price, so compare against the variant's net `price`
        variantPrice = variant.price;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let secondOrderLineId: string;

    it('does not add surcharge', async () => {
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 1,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].unitPrice).toEqual(variantPrice);
    });

    it('adds a surcharge', async () => {
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 1,
            customFields: {
                giftWrap: true,
            },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].unitPrice).toEqual(variantPrice);
        expect(addItemToOrder.lines[1].unitPrice).toEqual(variantPrice + 500);
        expect(addItemToOrder.subTotal).toEqual(variantPrice + variantPrice + 500);
        secondOrderLineId = addItemToOrder.lines[1].id;
    });

    it('re-calculates when customFields changes', async () => {
        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: secondOrderLineId,
            quantity: 1,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);

        expect(adjustOrderLine.lines[0].unitPrice).toEqual(variantPrice);
        expect(adjustOrderLine.lines[1].unitPrice).toEqual(variantPrice);
        expect(adjustOrderLine.subTotal).toEqual(variantPrice + variantPrice);
    });

    it('applies discount for quantity greater than 3', async () => {
        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: secondOrderLineId,
            quantity: 4,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);

        expect(adjustOrderLine.lines[1].unitPrice).toEqual(variantPrice / 2);
        expect(adjustOrderLine.subTotal).toEqual(variantPrice + (variantPrice / 2) * 4);
    });

    it('applies a commercial promotion on top of the quoted price', async () => {
        await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: 'EXTRA-FIVE',
                translations: [{ languageCode: LanguageCode.en, name: '5% off' }],
                conditions: [],
                actions: [
                    {
                        code: 'products_percentage_discount',
                        arguments: [
                            { name: 'discount', value: '5' },
                            { name: 'productVariantIds', value: JSON.stringify([variantId]) },
                        ],
                    },
                ],
            },
        });
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 20,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);
        expect(addItemToOrder.subTotalWithTax).toBe(19190);
        const { applyCouponCode } = await shopClient.query(applyCouponCodeDocument, {
            couponCode: 'EXTRA-FIVE',
        });
        expect(applyCouponCode).toMatchObject({ subTotalWithTax: 18230 });
    });

    it('clears a stored quote when the price strategy returns to unit pricing', async () => {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 20,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);
        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: addItemToOrder.lines[0].id,
            quantity: 1,
            customFields: { giftWrap: false },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        expect(activeOrder?.lines[0].linePrice).toBe(variantPrice);
    });

    it('keeps the quoted line total through reload, quantity changes and payment', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 20,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);
        const line = addItemToOrder.lines[0];
        expect(line.unitPriceWithTax).toBe(960);
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        expect(activeOrder?.lines.find(item => item.id === line.id)?.linePriceWithTax).toBe(19190);
        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: line.id,
            quantity: 11,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);
        await proceedToArrangingPayment(shopClient, 0);
        const beforePayment = (await shopClient.query(getActiveOrderWithPriceDataDocument)).activeOrder;
        if (!beforePayment) throw new Error('Expected an active order');
        expect(beforePayment.lines.find(item => item.id === line.id)?.linePriceWithTax).toBe(10555);
        const paid = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
        const payment = paid.payments?.[0];
        if (!payment) throw new Error('Expected a payment');
        expect(payment.amount).toBe(beforePayment.totalWithTax);
        const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
            input: { orderId: paid.id, lines: [{ orderLineId: line.id, quantity: 1 }] },
        });
        expect(cancelOrder).toMatchObject({ id: paid.id });
        for (const [quantity, total] of [
            [1, 960],
            [10, 9595],
        ]) {
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
                input: { lines: [{ orderLineId: line.id, quantity }], paymentId: payment.id },
            });
            expect(refundOrder).toMatchObject({ total });
        }
    });
});
