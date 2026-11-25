import { LanguageCode } from '@vendure/common/lib/generated-types';
import { DefaultMoneyStrategy, mergeConfig, TransactionalConnection } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import type { SqljsDriver } from 'typeorm/driver/sqljs/SqljsDriver';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    TestOrderItemPriceCalculationStrategy,
    TestQuotedLinePriceStrategy,
} from './fixtures/test-order-item-price-calculation-strategy';
import { singleStageRefundablePaymentMethod } from './fixtures/test-payment-methods';
import { graphql } from './graphql/graphql-admin';
import { FragmentOf } from './graphql/graphql-shop';
import {
    addManualPaymentToOrderDocument,
    adminTransitionToStateDocument,
    cancelOrderDocument,
    createPromotionDocument,
    getOrderWithLineCalculatedPropsDocument,
    getProductWithVariantsDocument,
    modifyOrderDocument,
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

// Rounds each unit before multiplying, so the tests show that a quote is not derived from the
// rounded unit price.
class ThreeDecimalMoneyStrategy extends DefaultMoneyStrategy {
    readonly precision = 3;
    round(value: number, quantity = 1): number {
        return Math.round(value) * quantity;
    }
}

describe('quoted order line prices', () => {
    let variantId: string;
    let otherVariantId: string;
    let variantPrice: number;
    const config = mergeConfig(testConfig(), {
        entityOptions: { moneyStrategy: new ThreeDecimalMoneyStrategy() },
        paymentOptions: { paymentMethodHandlers: [singleStageRefundablePaymentMethod] },
        customFields: {
            OrderLine: [{ name: 'giftWrap', type: 'boolean' }],
        },
        orderOptions: {
            orderItemPriceCalculationStrategy: new TestQuotedLinePriceStrategy(),
        },
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);

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
        const [variant, otherVariant] = product?.variants ?? [];
        if (!variant || !otherVariant) {
            throw new Error('Could not find a product variant for test setup');
        }
        variantId = variant.id;
        otherVariantId = otherVariant.id;
        // `unitPrice` is the net price, so compare against the variant's net `price`
        variantPrice = variant.price;
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('applies a commercial promotion on top of the quoted price', async () => {
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
        expect(beforePayment.lines.find(item => item.id === line.id)?.linePriceWithTax).toBe(10655);
        const paid = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
        const payment = paid.payments?.[0];
        if (!payment) throw new Error('Expected a payment');
        expect(payment.amount).toBe(beforePayment.totalWithTax);
        const { cancelOrder } = await adminClient.query(cancelOrderDocument, {
            input: { orderId: paid.id, lines: [{ orderLineId: line.id, quantity: 1 }] },
        });
        expect(cancelOrder).toMatchObject({ id: paid.id });
        for (const [quantity, total] of [
            [1, 969],
            [10, 9686],
        ]) {
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
                input: { lines: [{ orderLineId: line.id, quantity }], paymentId: payment.id },
            });
            expect(refundOrder).toMatchObject({ total });
        }
    });

    it.each(['reprice', 'add a promotion'])(
        'refunds the surviving units after a modification to %s',
        async change => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
                productVariantId: variantId,
                quantity: 11,
                customFields: { giftWrap: true },
            } as any);
            orderGuard.assertSuccess(addItemToOrder);
            const lineId = addItemToOrder.lines[0].id;
            await proceedToArrangingPayment(shopClient, 0);
            const paid = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
            const payment = paid.payments?.[0];
            if (!payment) throw new Error('Expected a payment');
            const lines = [{ orderLineId: lineId, quantity: 1 }];
            await adminClient.query(cancelOrderDocument, { input: { orderId: paid.id, lines } });
            const first = await adminClient.query(refundOrderDocument, {
                input: { paymentId: payment.id, lines },
            });
            expect(first.refundOrder).toMatchObject({ total: 969 });
            await adminClient.query(adminTransitionToStateDocument, { id: paid.id, state: 'Modifying' });
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    orderId: paid.id,
                    dryRun: false,
                    ...(change === 'reprice'
                        ? { adjustOrderLines: [{ orderLineId: lineId, quantity: 10 }] }
                        : { couponCodes: ['EXTRA-FIVE'], refunds: [{ paymentId: payment.id, amount: 484 }] }),
                },
            });
            const remaining = change === 'reprice' ? 9695 : 9202;
            expect(modifyOrder).toMatchObject({ id: paid.id, subTotalWithTax: remaining });
            const selection = [{ orderLineId: lineId, quantity: 10 }];
            const { previewRefundLineTotal } = await adminClient.query(
                graphql(`
                    query PreviewRemainingRefund($orderId: ID!, $lines: [OrderLineInput!]!) {
                        previewRefundLineTotal(orderId: $orderId, lines: $lines)
                    }
                `),
                { orderId: paid.id, lines: selection },
            );
            expect(previewRefundLineTotal).toBe(remaining);
            const last = await adminClient.query(refundOrderDocument, {
                input: { paymentId: payment.id, lines: selection },
            });
            expect(last.refundOrder).toMatchObject({ total: remaining });
        },
    );

    // A line-based refund leaves out lines that the placed order did not contain, so it records no
    // RefundLine for units that were never paid.
    it('leaves a quoted line added by a modification out of a line-based refund', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 11,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);
        await proceedToArrangingPayment(shopClient, 0);
        const paid = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
        const payment = paid.payments?.[0];
        if (!payment) throw new Error('Expected a payment');
        await adminClient.query(adminTransitionToStateDocument, { id: paid.id, state: 'Modifying' });
        const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
            input: {
                orderId: paid.id,
                dryRun: false,
                addItems: [
                    { productVariantId: otherVariantId, quantity: 10, customFields: { giftWrap: true } },
                ],
            },
        } as any);
        const addedLine = (modifyOrder as any).lines.find(
            (item: { productVariant: { id: string } }) => item.productVariant.id === otherVariantId,
        );
        await adminClient.query(adminTransitionToStateDocument, {
            id: paid.id,
            state: 'ArrangingAdditionalPayment',
        });
        const lines = [{ orderLineId: addedLine.id, quantity: 10 }];
        const rejected = await adminClient.query(refundOrderDocument, {
            input: { paymentId: payment.id, lines },
        });
        expect(rejected.refundOrder).toMatchObject({ errorCode: 'NOTHING_TO_REFUND_ERROR' });
        const previewDocument = graphql(`
            query PreviewQuotedRefund($orderId: ID!, $lines: [OrderLineInput!]!) {
                previewRefundLineTotal(orderId: $orderId, lines: $lines)
            }
        `);
        const preview = await adminClient.query(previewDocument, { orderId: paid.id, lines });
        expect(preview.previewRefundLineTotal).toBe(addedLine.proratedLinePriceWithTax);
        await expect(
            adminClient.query(previewDocument, {
                orderId: paid.id,
                lines: [{ orderLineId: addedLine.id, quantity: 11 }],
            }),
        ).rejects.toThrow('The specified quantity is greater than the available OrderItems');
        const getRefundLines = graphql(`
            query QuotedRefundLines($id: ID!) {
                order(id: $id) {
                    payments {
                        refunds {
                            total
                            lines {
                                orderLineId
                                quantity
                            }
                        }
                    }
                }
            }
        `);
        const before = await adminClient.query(getRefundLines, { id: paid.id });
        expect(before.order?.payments?.flatMap(p => p.refunds)).toEqual([]);

        const { addManualPaymentToOrder } = await adminClient.query(addManualPaymentToOrderDocument, {
            input: { orderId: paid.id, method: 'test', transactionId: 'ADDITIONAL', metadata: {} },
        });
        expect(addManualPaymentToOrder).toMatchObject({ id: paid.id });
        const { refundOrder } = await adminClient.query(refundOrderDocument, {
            input: { paymentId: payment.id, lines, amount: addedLine.proratedLinePriceWithTax },
        });
        expect(refundOrder).toMatchObject({ total: addedLine.proratedLinePriceWithTax });
        const after = await adminClient.query(getRefundLines, { id: paid.id });
        expect(after.order?.payments?.flatMap(p => p.refunds.flatMap(r => r.lines))).toEqual([
            { orderLineId: addedLine.id, quantity: 10 },
        ]);

        // A request that mixes a placed line with an added one refunds the placed line only.
        const placedLineId = addItemToOrder.lines[0].id;
        const { refundOrder: mixed } = await adminClient.query(refundOrderDocument, {
            input: {
                paymentId: payment.id,
                lines: [
                    { orderLineId: placedLineId, quantity: 1 },
                    { orderLineId: addedLine.id, quantity: 1 },
                ],
            },
        });
        // One of the 11 units of a quote of 10655.
        expect(mixed).toMatchObject({ total: 969 });
        const mixedLines = (await adminClient.query(getRefundLines, { id: paid.id })).order?.payments
            ?.flatMap(p => p.refunds)
            .find(refund => refund.total === (mixed as { total: number }).total)?.lines;
        expect(mixedLines).toEqual([{ orderLineId: placedLineId, quantity: 1 }]);
    });

    it('reloads a placed quote after removing the hook and synchronizing the database', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 20,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);
        await proceedToArrangingPayment(shopClient, 0);
        const paid = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);

        const cart = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variantId,
            quantity: 20,
            customFields: { giftWrap: true },
        } as any);
        orderGuard.assertSuccess(cart.addItemToOrder);
        const db = server.app.get(TransactionalConnection).rawConnection;
        if (config.dbConnectionOptions.type === 'sqljs') {
            // The SQL.js test initializer keeps writes in memory and reuses the seed file.
            config.dbConnectionOptions = {
                ...config.dbConnectionOptions,
                location: undefined,
                database: (db.driver as SqljsDriver).export(),
                autoSave: false,
                synchronize: true,
            };
        }
        config.orderOptions.orderItemPriceCalculationStrategy = new TestOrderItemPriceCalculationStrategy();
        await server.destroy();
        await server.bootstrap();
        await adminClient.asSuperAdmin();
        const { order } = await adminClient.query(getOrderWithLineCalculatedPropsDocument, { id: paid.id });
        expect(order?.lines[0]).toMatchObject({ linePriceWithTax: 19190, quantity: 20 });
        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: cart.addItemToOrder.lines[0].id,
            quantity: 2,
            customFields: { giftWrap: false },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);
        expect(adjustOrderLine.subTotal).toBe(2 * variantPrice);
    });
});
