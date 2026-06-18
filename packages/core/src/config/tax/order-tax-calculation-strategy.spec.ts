import { beforeAll, describe, expect, it } from 'vitest';

import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';
import { Surcharge } from '../../entity/surcharge/surcharge.entity';
import { createOrder, createRequestContext, taxCategoryStandard } from '../../testing/order-test-utils';
import { ensureConfigLoaded } from '../config-helpers';

import { DefaultOrderTaxCalculationStrategy } from './default-order-tax-calculation-strategy';
import { OrderLevelTaxCalculationStrategy } from './order-level-tax-calculation-strategy';

describe('OrderTaxCalculationStrategy', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    describe('DefaultOrderTaxCalculationStrategy', () => {
        const strategy = new DefaultOrderTaxCalculationStrategy();

        it('sums per-line totals for a single tax rate', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    { listPrice: 300, taxCategory: taxCategoryStandard, quantity: 2 },
                    { listPrice: 1000, taxCategory: taxCategoryStandard, quantity: 1 },
                ],
            });
            order.lines.forEach(l => (l.taxLines = [{ taxRate: 5, description: 'tax a' }]));

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(1600);
            expect(totals.subTotalWithTax).toBe(1680);
            expect(taxSummary).toEqual([{ description: 'tax a', taxRate: 5, taxBase: 1600, taxTotal: 80 }]);
        });

        it('includes surcharges with multiple tax lines in totals and summary', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 300, taxCategory: taxCategoryStandard, quantity: 2 }],
                surcharges: [
                    new Surcharge({
                        description: 'Extra',
                        listPrice: 400,
                        listPriceIncludesTax: false,
                        taxLines: [
                            { description: 'tax 50', taxRate: 50 },
                            { description: 'tax 20', taxRate: 20 },
                        ],
                        sku: 'extra',
                    }),
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 5, description: 'tax a' }];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(600 + 400);
            expect(totals.subTotalWithTax).toBe(1310);
            expect(taxSummary).toEqual([
                { description: 'tax a', taxRate: 5, taxBase: 600, taxTotal: 30 },
                { description: 'tax 50', taxRate: 50, taxBase: 400, taxTotal: 200 },
                { description: 'tax 20', taxRate: 20, taxBase: 400, taxTotal: 80 },
            ]);
        });

        it('handles shipping lines', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 300, taxCategory: taxCategoryStandard, quantity: 2 }],
            });
            order.lines[0].taxLines = [{ taxRate: 5, description: 'tax a' }];
            order.shippingLines = [
                new ShippingLine({
                    listPrice: 500,
                    listPriceIncludesTax: false,
                    adjustments: [],
                    taxLines: [{ taxRate: 20, description: 'shipping tax' }],
                }),
            ];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(600);
            expect(totals.shipping).toBe(500);
            expect(totals.shippingWithTax).toBe(600);
            expect(taxSummary).toHaveLength(2);
            expect(taxSummary).toEqual(
                expect.arrayContaining([
                    { description: 'tax a', taxRate: 5, taxBase: 600, taxTotal: 30 },
                    { description: 'shipping tax', taxRate: 20, taxBase: 500, taxTotal: 100 },
                ]),
            );
        });

        it('handles lines with no taxLines gracefully', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 100, taxCategory: taxCategoryStandard, quantity: 1 }],
            });
            order.lines[0].taxLines = [];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(100);
            expect(totals.subTotalWithTax).toBe(100);
            expect(taxSummary).toEqual([]);
        });
    });

    describe('OrderLevelTaxCalculationStrategy', () => {
        const strategy = new OrderLevelTaxCalculationStrategy();

        it('rounds tax on grouped net subtotal rather than per line', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    { listPrice: 102, taxCategory: taxCategoryStandard, quantity: 1 },
                    { listPrice: 215, taxCategory: taxCategoryStandard, quantity: 1 },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 21, description: 'VAT' }];
            order.lines[1].taxLines = [{ taxRate: 21, description: 'VAT' }];

            const defaultStrategy = new DefaultOrderTaxCalculationStrategy();
            const defaultTotals = defaultStrategy.calculateOrderTotals(order);
            const defaultTaxSummary = defaultStrategy.calculateTaxSummary(order);
            const orderLevelTotals = strategy.calculateOrderTotals(order);
            const orderLevelTaxSummary = strategy.calculateTaxSummary(order);

            // Both strategies agree on subTotal (net)
            expect(defaultTotals.subTotal).toBe(317);
            expect(orderLevelTotals.subTotal).toBe(317);

            // But subTotalWithTax differs due to rounding
            expect(defaultTotals.subTotalWithTax).toBe(383); // 123 + 260
            expect(orderLevelTotals.subTotalWithTax).toBe(384); // 317 + 67

            // Tax summary reflects the difference
            expect(defaultTaxSummary).toEqual([
                { description: 'VAT', taxRate: 21, taxBase: 317, taxTotal: 66 },
            ]);
            expect(orderLevelTaxSummary).toEqual([
                { description: 'VAT', taxRate: 21, taxBase: 317, taxTotal: 67 },
            ]);
        });

        it('handles multiple tax rates', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    { listPrice: 102, taxCategory: taxCategoryStandard, quantity: 1 },
                    { listPrice: 215, taxCategory: taxCategoryStandard, quantity: 1 },
                    { listPrice: 500, taxCategory: taxCategoryStandard, quantity: 1 },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 21, description: 'Standard VAT' }];
            order.lines[1].taxLines = [{ taxRate: 21, description: 'Standard VAT' }];
            order.lines[2].taxLines = [{ taxRate: 9, description: 'Reduced VAT' }];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(817);
            expect(taxSummary).toEqual([
                {
                    description: 'Standard VAT',
                    taxRate: 21,
                    taxBase: 317,
                    taxTotal: Math.round(317 * 0.21), // 67
                },
                {
                    description: 'Reduced VAT',
                    taxRate: 9,
                    taxBase: 500,
                    taxTotal: Math.round(500 * 0.09), // 45
                },
            ]);
            expect(totals.subTotalWithTax).toBe(817 + 67 + 45);
        });

        it('handles zero-rate items', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 300, taxCategory: taxCategoryStandard, quantity: 2 }],
            });
            order.lines[0].taxLines = [{ taxRate: 0, description: 'zero-rate' }];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(600);
            expect(totals.subTotalWithTax).toBe(600);
            expect(taxSummary).toEqual([{ description: 'zero-rate', taxRate: 0, taxBase: 600, taxTotal: 0 }]);
        });

        it('handles surcharges with multiple tax lines', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 300, taxCategory: taxCategoryStandard, quantity: 2 }],
                surcharges: [
                    new Surcharge({
                        description: 'Special',
                        listPrice: 400,
                        listPriceIncludesTax: false,
                        taxLines: [
                            { description: 'tax 50', taxRate: 50 },
                            { description: 'tax 20', taxRate: 20 },
                        ],
                        sku: 'special',
                    }),
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 5, description: 'tax a' }];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(1000);
            expect(taxSummary).toHaveLength(3);
            expect(taxSummary).toEqual(
                expect.arrayContaining([
                    { description: 'tax a', taxRate: 5, taxBase: 600, taxTotal: 30 },
                    { description: 'tax 50', taxRate: 50, taxBase: 400, taxTotal: 200 },
                    { description: 'tax 20', taxRate: 20, taxBase: 400, taxTotal: 80 },
                ]),
            );
            // Total tax = 30 + 200 + 80 = 310
            expect(totals.subTotalWithTax).toBe(1000 + 310);
        });

        it('handles shipping lines', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 300, taxCategory: taxCategoryStandard, quantity: 2 }],
            });
            order.lines[0].taxLines = [{ taxRate: 5, description: 'tax a' }];
            order.shippingLines = [
                new ShippingLine({
                    listPrice: 500,
                    listPriceIncludesTax: false,
                    adjustments: [],
                    taxLines: [{ taxRate: 20, description: 'shipping tax' }],
                }),
            ];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(600);
            expect(totals.shipping).toBe(500);
            expect(totals.shippingWithTax).toBe(600);
            expect(taxSummary).toHaveLength(2);
            expect(taxSummary).toEqual(
                expect.arrayContaining([
                    { description: 'tax a', taxRate: 5, taxBase: 600, taxTotal: 30 },
                    { description: 'shipping tax', taxRate: 20, taxBase: 500, taxTotal: 100 },
                ]),
            );
        });

        it('groups multiple shipping lines by rate', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 100, taxCategory: taxCategoryStandard, quantity: 1 }],
            });
            order.lines[0].taxLines = [{ taxRate: 21, description: 'VAT' }];
            order.shippingLines = [
                new ShippingLine({
                    listPrice: 102,
                    listPriceIncludesTax: false,
                    adjustments: [],
                    taxLines: [{ taxRate: 21, description: 'VAT' }],
                }),
                new ShippingLine({
                    listPrice: 215,
                    listPriceIncludesTax: false,
                    adjustments: [],
                    taxLines: [{ taxRate: 21, description: 'VAT' }],
                }),
            ];

            const defaultStrategy = new DefaultOrderTaxCalculationStrategy();
            const defaultTotals = defaultStrategy.calculateOrderTotals(order);
            const orderLevelTotals = strategy.calculateOrderTotals(order);

            // Shipping net totals are the same
            expect(defaultTotals.shipping).toBe(317);
            expect(orderLevelTotals.shipping).toBe(317);

            // But shipping tax may differ due to rounding
            // Default: round(102*0.21) + round(215*0.21) = round(21.42) + round(45.15) = 21 + 45 = 66
            // Order-level: round(317 * 0.21) = round(66.57) = 67
            expect(defaultTotals.shippingWithTax).toBe(317 + 21 + 45); // 383
            expect(orderLevelTotals.shippingWithTax).toBe(317 + 67); // 384
        });

        it('merges same tax rate on items and shipping with consistent rounding', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [
                    { listPrice: 102, taxCategory: taxCategoryStandard, quantity: 1 },
                    { listPrice: 215, taxCategory: taxCategoryStandard, quantity: 1 },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 21, description: 'VAT' }];
            order.lines[1].taxLines = [{ taxRate: 21, description: 'VAT' }];
            order.shippingLines = [
                new ShippingLine({
                    listPrice: 500,
                    listPriceIncludesTax: false,
                    adjustments: [],
                    taxLines: [{ taxRate: 21, description: 'VAT' }],
                }),
            ];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            // Items: round(317 * 0.21) = round(66.57) = 67
            // Shipping: round(500 * 0.21) = round(105) = 105
            expect(totals.subTotal).toBe(317);
            expect(totals.subTotalWithTax).toBe(384);
            expect(totals.shipping).toBe(500);
            expect(totals.shippingWithTax).toBe(605);

            // Tax summary should merge into one entry with tax = 67 + 105 = 172
            // (not re-rounded from combined netBase: round(817 * 0.21) = round(171.57) = 172)
            expect(taxSummary).toEqual([{ description: 'VAT', taxRate: 21, taxBase: 817, taxTotal: 172 }]);

            // Verify taxTotal matches the sum of item tax + shipping tax from totals
            const totalTaxFromTotals =
                totals.subTotalWithTax - totals.subTotal + (totals.shippingWithTax - totals.shipping);
            expect(taxSummary[0].taxTotal).toBe(totalTaxFromTotals);
        });

        it('handles prices-include-tax mode', () => {
            const ctx = createRequestContext({ pricesIncludeTax: true });
            const order = createOrder({
                ctx,
                lines: [
                    { listPrice: 123, taxCategory: taxCategoryStandard, quantity: 1 },
                    { listPrice: 260, taxCategory: taxCategoryStandard, quantity: 1 },
                ],
            });
            order.lines[0].taxLines = [{ taxRate: 21, description: 'VAT' }];
            order.lines[1].taxLines = [{ taxRate: 21, description: 'VAT' }];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);

            expect(totals.subTotal).toBe(317);
            expect(totals.subTotalWithTax).toBe(384);
            expect(taxSummary).toEqual([{ description: 'VAT', taxRate: 21, taxBase: 317, taxTotal: 67 }]);
        });

        it('handles lines with no taxLines gracefully', () => {
            const ctx = createRequestContext({ pricesIncludeTax: false });
            const order = createOrder({
                ctx,
                lines: [{ listPrice: 100, taxCategory: taxCategoryStandard, quantity: 1 }],
            });
            order.lines[0].taxLines = [];
            order.shippingLines = [
                new ShippingLine({
                    shippingMethodId: '1',
                }),
            ];

            const totals = strategy.calculateOrderTotals(order);
            const taxSummary = strategy.calculateTaxSummary(order);
            expect(totals.subTotal).toBe(100);
            expect(taxSummary).toEqual([]);
        });
    });
});
