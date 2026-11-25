import { CalculateTaxLinesArgs, mergeConfig, TaxLineCalculationStrategy } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { singleStageRefundablePaymentMethod } from './fixtures/test-payment-methods';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql } from './graphql/graphql-shop';
import { cancelOrderDocument, refundOrderDocument } from './graphql/shared-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

/**
 * Stands in for an ERP that calculates the tax itself and rounds it its own way. It adds one minor
 * unit to the tax that the rate gives, so the tests can tell its amount from Vendure's own result.
 */
class ErpTaxLineCalculationStrategy implements TaxLineCalculationStrategy {
    calculate({ orderLine, applicableTaxRate }: CalculateTaxLinesArgs) {
        const lineTotal = orderLine.listPriceIncludesTax
            ? orderLine.proratedLinePriceWithTax
            : orderLine.proratedLinePrice;
        return [
            {
                description: applicableTaxRate.name,
                taxRate: applicableTaxRate.value,
                amount: Math.round((lineTotal * applicableTaxRate.value) / 100) + 1,
            },
        ];
    }
}

const activeOrderTaxesDocument = graphql(`
    query ActiveOrderTaxes {
        activeOrder {
            id
            subTotal
            subTotalWithTax
            taxSummary {
                taxRate
                taxBase
                taxTotal
            }
            lines {
                id
                quantity
                proratedLinePrice
                proratedLinePriceWithTax
                proratedUnitPriceWithTax
                taxRate
                taxLines {
                    taxRate
                    amount
                }
            }
        }
    }
`);

const addItemDocument = graphql(`
    mutation AddItemForTaxAmounts($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ... on Order {
                id
            }
        }
    }
`);

const orderTaxesDocument = adminGraphql(`
    query OrderTaxes($id: ID!) {
        order(id: $id) {
            id
            subTotal
            subTotalWithTax
            lines {
                id
                quantity
                proratedLinePrice
                proratedLinePriceWithTax
                proratedUnitPriceWithTax
                taxLines {
                    amount
                }
            }
        }
    }
`);

// OSS-1507: a TaxLineCalculationStrategy can return the absolute tax of a line
describe('OrderLine tax amounts from a TaxLineCalculationStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: { paymentMethodHandlers: [singleStageRefundablePaymentMethod] },
            taxOptions: { taxLineCalculationStrategy: new ErpTaxLineCalculationStrategy() },
        }),
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
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let orderId: string;
    let lineId: string;
    let paymentId: string;
    let paidLineTotal: number;

    it('uses the amount as the tax of the line and the order', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(addItemDocument, { productVariantId: 'T_1', quantity: 3 });
        const { activeOrder } = await shopClient.query(activeOrderTaxesDocument);
        if (!activeOrder) throw new Error('Expected an active order');
        const [line] = activeOrder.lines;
        const rateTax = Math.round((line.proratedLinePrice * line.taxRate) / 100);
        const amount = line.taxLines[0].amount;

        expect(amount).toBe(rateTax + 1);
        expect(line.taxLines[0].taxRate).toBe(line.taxRate);
        expect(line.proratedLinePriceWithTax - line.proratedLinePrice).toBe(amount);
        expect(activeOrder.subTotalWithTax - activeOrder.subTotal).toBe(amount);
        expect(activeOrder.taxSummary).toEqual([
            { taxRate: line.taxRate, taxBase: line.proratedLinePrice, taxTotal: amount },
        ]);
        lineId = line.id;
    });

    it('keeps the amount through checkout and payment', async () => {
        await proceedToArrangingPayment(shopClient, 0);
        const { activeOrder } = await shopClient.query(activeOrderTaxesDocument);
        if (!activeOrder) throw new Error('Expected an active order');
        const order = await addPaymentToOrder(shopClient, singleStageRefundablePaymentMethod);
        const payment = order.payments?.[0];
        if (!payment) throw new Error('Expected a payment');

        expect(payment.amount).toBe(order.totalWithTax);
        expect(order.subTotalWithTax).toBe(activeOrder.subTotalWithTax);
        paidLineTotal = activeOrder.lines[0].proratedLinePriceWithTax;
        orderId = order.id;
        paymentId = payment.id;
    });

    it('gives the remaining units their share of the amount after a partial cancellation', async () => {
        const before = (await adminClient.query(orderTaxesDocument, { id: orderId })).order;
        if (!before) throw new Error('Expected an order');
        const lineBefore = before.lines[0];
        const amount = lineBefore.proratedLinePriceWithTax - lineBefore.proratedLinePrice;

        await adminClient.query(cancelOrderDocument, {
            input: { orderId, lines: [{ orderLineId: lineId, quantity: 1 }] },
        });
        const after = (await adminClient.query(orderTaxesDocument, { id: orderId })).order;
        if (!after) throw new Error('Expected an order');
        const lineAfter = after.lines[0];

        expect(lineAfter.quantity).toBe(2);
        expect(lineAfter.proratedLinePriceWithTax - lineAfter.proratedLinePrice).toBe(
            Math.round((amount * 2) / 3),
        );
        expect(after.subTotalWithTax - after.subTotal).toBe(
            lineAfter.proratedLinePriceWithTax - lineAfter.proratedLinePrice,
        );
        // The stored amount is the tax of the remaining units.
        expect(lineAfter.taxLines[0].amount).toBe(
            lineAfter.proratedLinePriceWithTax - lineAfter.proratedLinePrice,
        );
    });

    it('refunds the cancelled and remaining units for exactly what was paid', async () => {
        const { order } = await adminClient.query(orderTaxesDocument, { id: orderId });
        if (!order) throw new Error('Expected an order');
        const totals: number[] = [];
        for (let i = 0; i < 3; i++) {
            const { refundOrder } = await adminClient.query(refundOrderDocument, {
                input: { lines: [{ orderLineId: lineId, quantity: 1 }], paymentId },
            });
            totals.push((refundOrder as { total: number }).total);
        }

        expect(totals.reduce((sum, total) => sum + total, 0)).toBe(paidLineTotal);
    });
});
