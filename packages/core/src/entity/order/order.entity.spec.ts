import { AdjustmentType } from '@vendure/common/lib/generated-types';
import { summate } from '@vendure/common/lib/shared-utils';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../config/config-helpers';
import { createOrder, createRequestContext, taxCategoryStandard } from '../../testing/order-test-utils';
import { ShippingLine } from '../shipping-line/shipping-line.entity';
import { Surcharge } from '../surcharge/surcharge.entity';

import { Order } from './order.entity';

describe('Order entity methods', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    describe('taxSummary', () => {
        it('single rate across items', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.lines.forEach(i => (i.taxLines = [{ taxRate: 5, description: 'tax a' }]));

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 1600,
                    taxTotal: 80,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('different rate on each item', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 5, description: 'tax a' }];
            order.lines[1].taxLines = [{ taxRate: 7.5, description: 'tax b' }];

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 600,
                    taxTotal: 30,
                },
                {
                    description: 'tax b',
                    taxRate: 7.5,
                    taxBase: 1000,
                    taxTotal: 75,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('multiple rates on each item', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.lines[0].taxLines = [
                { taxRate: 5, description: 'tax a' },
                { taxRate: 7.5, description: 'tax b' },
            ];
            order.lines[1].taxLines = [
                { taxRate: 5, description: 'tax a' },
                { taxRate: 7.5, description: 'tax b' },
            ];

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 1600,
                    taxTotal: 80,
                },
                {
                    description: 'tax b',
                    taxRate: 7.5,
                    taxBase: 1600,
                    taxTotal: 120,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('multiple rates on each item, prorated order discount', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.lines[0].taxLines = [
                { taxRate: 5, description: 'tax a' },
                { taxRate: 7.5, description: 'tax b' },
            ];
            order.lines[0].adjustments = [
                {
                    amount: -60,
                    adjustmentSource: 'some order discount',
                    description: 'some order discount',
                    type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
                },
            ];
            order.lines[1].taxLines = [
                { taxRate: 5, description: 'tax a' },
                { taxRate: 7.5, description: 'tax b' },
            ];
            order.lines[1].adjustments = [
                {
                    amount: -100,
                    adjustmentSource: 'some order discount',
                    description: 'some order discount',
                    type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
                },
            ];

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 1440,
                    taxTotal: 72,
                },
                {
                    description: 'tax b',
                    taxRate: 7.5,
                    taxBase: 1440,
                    taxTotal: 109,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('multiple rates on each item, item discount, prorated order discount', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.lines[0].taxLines = [
                { taxRate: 5, description: 'tax a' },
                { taxRate: 7.5, description: 'tax b' },
            ];
            order.lines[0].adjustments = [
                {
                    amount: -60,
                    adjustmentSource: 'some order discount',
                    description: 'some order discount',
                    type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
                },
                {
                    amount: -250,
                    adjustmentSource: 'some item discount',
                    description: 'some item discount',
                    type: AdjustmentType.PROMOTION,
                },
            ];

            order.lines[1].taxLines = [
                { taxRate: 5, description: 'tax a' },
                { taxRate: 7.5, description: 'tax b' },
            ];
            order.lines[1].adjustments = [
                {
                    amount: -100,
                    adjustmentSource: 'some order discount',
                    description: 'some order discount',
                    type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
                },
            ];

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 1190,
                    taxTotal: 59,
                },
                {
                    description: 'tax b',
                    taxRate: 7.5,
                    taxBase: 1190,
                    taxTotal: 90,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('zero rate', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 0, description: 'zero-rate' }];

            expect(order.taxSummary).toEqual([
                {
                    description: 'zero-rate',
                    taxRate: 0,
                    taxBase: 600,
                    taxTotal: 0,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('with shipping', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 5, description: 'tax a' }];
            order.lines[1].taxLines = [{ taxRate: 5, description: 'tax a' }];
            order.shippingLines = [
                new ShippingLine({
                    listPrice: 500,
                    listPriceIncludesTax: false,
                    taxLines: [
                        {
                            taxRate: 20,
                            description: 'shipping tax',
                        },
                    ],
                }),
            ];
            order.shipping = 500;
            order.shippingWithTax = 600;

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 1600,
                    taxTotal: 80,
                },
                {
                    description: 'shipping tax',
                    taxRate: 20,
                    taxBase: 500,
                    taxTotal: 100,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });

        it('with surcharge', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    {
                        listPrice: 300,
                        taxCategory: taxCategoryStandard,
                        quantity: 2,
                    },
                    {
                        listPrice: 1000,
                        taxCategory: taxCategoryStandard,
                        quantity: 1,
                    },
                ],
                surcharges: [
                    new Surcharge({
                        description: 'Special surcharge',
                        listPrice: 400,
                        listPriceIncludesTax: ctx.channel.pricesIncludeTax,
                        taxLines: [
                            { description: 'Special surcharge tax', taxRate: 50 },
                            { description: 'Special surcharge second tax', taxRate: 20 },
                        ],
                        sku: 'special-surcharge',
                    }),
                    new Surcharge({
                        description: 'Other surcharge',
                        listPrice: 500,
                        listPriceIncludesTax: ctx.channel.pricesIncludeTax,
                        taxLines: [{ description: 'Other surcharge tax', taxRate: 0 }],
                        sku: 'other-surcharge',
                    }),
                ],
            });
            order.lines.forEach(i => (i.taxLines = [{ taxRate: 5, description: 'tax a' }]));

            expect(order.taxSummary).toEqual([
                {
                    description: 'tax a',
                    taxRate: 5,
                    taxBase: 1600,
                    taxTotal: 80,
                },
                {
                    description: 'Special surcharge tax',
                    taxRate: 50,
                    taxBase: 400,
                    taxTotal: 200,
                },
                {
                    description: 'Special surcharge second tax',
                    taxRate: 20,
                    taxBase: 400,
                    taxTotal: 80,
                },
                {
                    description: 'Other surcharge tax',
                    taxRate: 0,
                    taxBase: 500,
                    taxTotal: 0,
                },
            ]);
            assertOrderTaxesAddsUp(order);
        });
    });
});

function assertOrderTaxesAddsUp(order: Order) {
    const summaryTaxTotal = summate(order.taxSummary, 'taxTotal');
    const lineTotal = summate(order.lines, 'proratedLinePrice');
    const lineTotalWithTax = summate(order.lines, 'proratedLinePriceWithTax');
    const shippingTax = (order.shippingWithTax ?? 0) - (order.shipping ?? 0);
    const surchargesTotal = summate(order.surcharges, 'price');
    const surchargesTotalWithTax = summate(order.surcharges, 'priceWithTax');
    expect(lineTotalWithTax - lineTotal + shippingTax + (surchargesTotalWithTax - surchargesTotal)).toBe(
        summaryTaxTotal,
    );
}
