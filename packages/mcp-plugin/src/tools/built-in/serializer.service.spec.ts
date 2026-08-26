import { InsufficientStockError, Order } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { McpToolSerializerService } from './serializer.service';

/** A stand-in for Vendure's ConfigService carrying only what the serializer reads. */
function configWithPrecision(precision: number | undefined) {
    return { entityOptions: { moneyStrategy: { precision } } } as any;
}

describe('McpToolSerializerService', () => {
    const service = new McpToolSerializerService(configWithPrecision(2));

    it('serializes a variant with the same fields the old function returned', () => {
        expect(
            service.variant({
                id: 27,
                name: 'Instant Camera',
                sku: 'IC-27',
                enabled: true,
                price: 20999,
                priceWithTax: 25199,
            } as any),
        ).toEqual({
            id: 27,
            name: 'Instant Camera',
            sku: 'IC-27',
            enabled: true,
            price: 20999,
            priceDecimal: '209.99',
            priceWithTax: 25199,
            priceWithTaxDecimal: '251.99',
            currencyCode: undefined,
        });
    });

    it('returns null for a missing variant or order', () => {
        expect(service.variant(null)).toBeNull();
        expect(service.order(undefined)).toBeNull();
    });

    it('passes a Vendure error result straight through instead of serializing it', () => {
        const errorResult = {
            __typename: 'OrderLimitError',
            errorCode: 'ORDER_LIMIT_ERROR',
            message: 'Too many items',
        };
        // Returned bare, not wrapped: the registry recognises a Vendure error result at the top
        // level of a tool's output and reports the call as failed.
        expect(service.orderOrError(errorResult)).toEqual(errorResult);
    });

    it("serializes an option group with its options, which is where a variant's optionIds come from", () => {
        expect(
            service.optionGroup({
                id: 3,
                code: 'size',
                name: 'Size',
                options: [
                    { id: 7, code: 'small', name: 'Small' },
                    { id: 8, code: 'large', name: 'Large' },
                ],
            } as any),
        ).toEqual({
            id: 3,
            code: 'size',
            name: 'Size',
            options: [
                { id: 7, code: 'small', name: 'Small' },
                { id: 8, code: 'large', name: 'Large' },
            ],
        });
    });

    it('serializes a stock level with the location id adjust_stock needs', () => {
        expect(
            service.stockLevel({
                stockLocationId: 1,
                stockLocation: { id: 1, name: 'Default Stock Location' },
                stockOnHand: 100,
                stockAllocated: 3,
            } as any),
        ).toEqual({
            stockLocationId: 1,
            stockLocationName: 'Default Stock Location',
            stockOnHand: 100,
            stockAllocated: 3,
        });
    });

    it('gives a stock level a null location name when the location relation was not loaded', () => {
        expect(
            service.stockLevel({ stockLocationId: 1, stockOnHand: 100, stockAllocated: 0 } as any),
        ).toEqual({
            stockLocationId: 1,
            stockLocationName: null,
            stockOnHand: 100,
            stockAllocated: 0,
        });
    });

    it('serializes a customer group', () => {
        expect(service.customerGroup({ id: 2, name: 'Wholesale' } as any)).toEqual({
            id: 2,
            name: 'Wholesale',
        });
    });

    it('adds decimal prices and the order currency to a shipping quote', () => {
        expect(
            service.shippingQuote(
                {
                    id: 1,
                    code: 'standard-shipping',
                    name: 'Standard Shipping',
                    description: '',
                    price: 500,
                    priceWithTax: 600,
                } as any,
                'USD' as any,
            ),
        ).toEqual({
            id: 1,
            code: 'standard-shipping',
            name: 'Standard Shipping',
            description: '',
            price: 500,
            priceDecimal: '5.00',
            priceWithTax: 600,
            priceWithTaxDecimal: '6.00',
            currencyCode: 'USD',
        });
    });

    it('keeps whatever a shipping calculator attached to a quote', () => {
        expect(
            service.shippingQuote(
                {
                    id: 1,
                    code: 'standard-shipping',
                    name: 'Standard Shipping',
                    description: '',
                    price: 500,
                    priceWithTax: 600,
                    metadata: { carrier: 'Royal Mail' },
                    customFields: { warehouse: 'north' },
                } as any,
                'GBP' as any,
            ),
        ).toMatchObject({
            metadata: { carrier: 'Royal Mail' },
            customFields: { warehouse: 'north' },
        });
    });

    it("turns an order's dates into ISO strings", () => {
        const serialized = service.order({
            id: 1,
            code: 'T_1',
            state: 'PaymentSettled',
            createdAt: new Date('2026-08-16T09:21:00.000Z'),
            updatedAt: new Date('2026-08-18T11:42:00.000Z'),
            orderPlacedAt: new Date('2026-08-16T09:30:00.000Z'),
            lines: [],
            discounts: [],
        } as any);

        expect(serialized).toMatchObject({
            createdAt: '2026-08-16T09:21:00.000Z',
            updatedAt: '2026-08-18T11:42:00.000Z',
            orderPlacedAt: '2026-08-16T09:30:00.000Z',
        });
    });

    it("serializes an order's payments and shows only the public part of their metadata", () => {
        const serialized = service.order({
            id: 1,
            code: 'T_1',
            state: 'ArrangingPayment',
            lines: [],
            discounts: [],
            payments: [
                {
                    id: 4,
                    method: 'redirect-payment',
                    amount: 25199,
                    state: 'Created',
                    transactionId: 'tx-1',
                    errorMessage: undefined,
                    metadata: { public: { redirectUrl: 'https://pay.example.com/x' }, secret: 'hidden' },
                },
            ],
        } as any);

        expect(serialized?.payments).toEqual([
            {
                id: 4,
                method: 'redirect-payment',
                amount: 25199,
                amountDecimal: '251.99',
                state: 'Created',
                transactionId: 'tx-1',
                errorMessage: undefined,
                publicMetadata: { redirectUrl: 'https://pay.example.com/x' },
            },
        ]);
        expect(JSON.stringify(serialized)).not.toContain('hidden');
    });

    it('gives publicMetadata null when the handler stored no public metadata', () => {
        const serialized = service.order({
            id: 1,
            code: 'T_1',
            state: 'ArrangingPayment',
            lines: [],
            discounts: [],
            payments: [{ id: 4, method: 'cash', amount: 100, state: 'Settled', metadata: {} }],
        } as any);

        expect(serialized?.payments?.[0].publicMetadata).toBeNull();
    });

    it("serializes an order's shipping lines, and omits them when the relation was not loaded", () => {
        const withLines = service.order({
            id: 1,
            code: 'T_1',
            state: 'ArrangingPayment',
            lines: [],
            discounts: [],
            shippingWithTax: 500,
            shippingLines: [{ id: 9, shippingMethodId: 2, priceWithTax: 500 }],
        } as any);
        expect(withLines).toMatchObject({
            shippingWithTax: 500,
            shippingWithTaxDecimal: '5.00',
            shippingLines: [{ id: 9, shippingMethodId: 2, priceWithTax: 500, priceWithTaxDecimal: '5.00' }],
        });

        const withoutRelation = service.order({
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            discounts: [],
        } as any);
        expect(withoutRelation?.shippingLines).toBeUndefined();
    });

    it('omits payments when the relation was not loaded', () => {
        const serialized = service.order({
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            discounts: [],
        } as any);

        expect(serialized?.payments).toBeUndefined();
        expect('payments' in JSON.parse(JSON.stringify(serialized))).toBe(false);
    });

    it('serializes an order and its lines', () => {
        expect(
            service.order({
                id: 1,
                code: 'T_1',
                state: 'AddingItems',
                active: true,
                total: 20999,
                totalWithTax: 25199,
                currencyCode: 'USD',
                totalQuantity: 1,
                couponCodes: [],
                discounts: [],
                lines: [
                    {
                        id: 5,
                        quantity: 1,
                        linePriceWithTax: 25199,
                        productVariant: {
                            id: 27,
                            name: 'Instant Camera',
                            sku: 'IC-27',
                            enabled: true,
                            price: 20999,
                            priceWithTax: 25199,
                        },
                    },
                ],
            } as any),
        ).toEqual({
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            active: true,
            total: 20999,
            totalDecimal: '209.99',
            totalWithTax: 25199,
            totalWithTaxDecimal: '251.99',
            currencyCode: 'USD',
            totalQuantity: 1,
            createdAt: null,
            updatedAt: null,
            orderPlacedAt: null,
            couponCodes: [],
            discounts: [],
            lines: [
                {
                    id: 5,
                    quantity: 1,
                    linePriceWithTax: 25199,
                    linePriceWithTaxDecimal: '251.99',
                    productVariant: {
                        id: 27,
                        name: 'Instant Camera',
                        sku: 'IC-27',
                        enabled: true,
                        price: 20999,
                        priceDecimal: '209.99',
                        priceWithTax: 25199,
                        priceWithTaxDecimal: '251.99',
                        currencyCode: undefined,
                    },
                },
            ],
            shippingWithTax: undefined,
            shippingWithTaxDecimal: '0.00',
            shippingLines: undefined,
        });
    });

    it("lists an order's coupon codes and the discounts they earned", () => {
        const serialized = service.order({
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            couponCodes: ['SAVE10', 'FREESHIP'],
            // Core groups these by promotion before the serializer sees them, and the amounts it
            // hands over are negative.
            discounts: [
                {
                    adjustmentSource: 'PROMOTION:1',
                    type: 'DISTRIBUTED_ORDER_PROMOTION',
                    description: 'Ten percent off',
                    amount: -2100,
                    amountWithTax: -2520,
                },
                {
                    adjustmentSource: 'PROMOTION:2',
                    type: 'DISTRIBUTED_ORDER_PROMOTION',
                    description: 'Free shipping',
                    amount: -500,
                    amountWithTax: -600,
                },
            ],
        } as any);

        expect(serialized?.couponCodes).toEqual(['SAVE10', 'FREESHIP']);
        expect(serialized?.discounts).toEqual([
            {
                adjustmentSource: 'PROMOTION:1',
                type: 'DISTRIBUTED_ORDER_PROMOTION',
                description: 'Ten percent off',
                amount: -2100,
                amountDecimal: '-21.00',
                amountWithTax: -2520,
                amountWithTaxDecimal: '-25.20',
            },
            {
                adjustmentSource: 'PROMOTION:2',
                type: 'DISTRIBUTED_ORDER_PROMOTION',
                description: 'Free shipping',
                amount: -500,
                amountDecimal: '-5.00',
                amountWithTax: -600,
                amountWithTaxDecimal: '-6.00',
            },
        ]);
    });

    it('lets core complain about an order whose lines were not loaded', () => {
        // Reading discounts off an order with no lines is core's error to raise. Swallowing it
        // here would answer a caller that forgot the relation with an empty discount list.
        const notLoaded = new Order();

        expect(() => service.order(notLoaded)).toThrow();
    });

    it('serializes the order that core attaches to an insufficient-stock error', () => {
        const cart = new Order();
        cart.id = 1;
        cart.code = 'T_1';
        cart.lines = [];
        cart.shippingLines = [];
        // totalWithTax is a getter over these two, so the fixture sets what it reads.
        cart.subTotalWithTax = 25199;
        cart.shippingWithTax = 0;

        const serialized: any = service.orderOrError(
            new InsufficientStockError({ order: cart, quantityAvailable: 3 }),
        );

        expect(serialized.errorCode).toBe('INSUFFICIENT_STOCK_ERROR');
        expect(serialized.quantityAvailable).toBe(3);
        // The registry finds a Vendure error result by these keys, so they have to survive the copy.
        expect(serialized.__typename).toBe('InsufficientStockError');
        expect(serialized.message).toBeTruthy();
        expect(serialized.order.totalWithTaxDecimal).toBe('251.99');
        expect(serialized.order.discounts).toEqual([]);
    });

    it("adds decimal twins to the coupon-removed error's two totals", () => {
        const removed = {
            __typename: 'CouponRemovedDuringCheckoutError',
            errorCode: 'COUPON_REMOVED_DURING_CHECKOUT_ERROR',
            message: 'COUPON_REMOVED_DURING_CHECKOUT_ERROR',
            currencyCode: 'USD',
            newTotalWithTax: 25199,
            previousTotalWithTax: 22679,
            removedCouponCodes: ['SAVE10'],
        };

        expect(service.orderOrError(removed)).toEqual({
            ...removed,
            newTotalWithTaxDecimal: '251.99',
            previousTotalWithTaxDecimal: '226.79',
        });
    });
});

describe('money scaling', () => {
    it('scales by the store precision of two decimal places', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        const variant = service.variant({
            id: 27,
            name: 'Instant Camera',
            sku: 'IC-27',
            enabled: true,
            price: 20999,
            priceWithTax: 25199,
            currencyCode: 'USD',
        } as any);
        expect(variant).toMatchObject({
            price: 20999,
            priceDecimal: '209.99',
            priceWithTax: 25199,
            priceWithTaxDecimal: '251.99',
            currencyCode: 'USD',
        });
    });

    it('pads amounts smaller than one whole unit', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        expect(service.variant({ id: 1, price: 5, priceWithTax: 60 } as any)).toMatchObject({
            priceDecimal: '0.05',
            priceWithTaxDecimal: '0.60',
        });
    });

    it('emits no decimal point for a currency the store keeps whole', () => {
        const service = new McpToolSerializerService(configWithPrecision(0));
        expect(service.variant({ id: 1, price: 1000, priceWithTax: 1000 } as any)).toMatchObject({
            priceDecimal: '1000',
            priceWithTaxDecimal: '1000',
        });
    });

    it('honours a store configured for three decimal places', () => {
        const service = new McpToolSerializerService(configWithPrecision(3));
        expect(service.variant({ id: 1, price: 25199, priceWithTax: 25199 } as any)).toMatchObject({
            priceDecimal: '25.199',
        });
    });

    it('falls back to two decimal places when the store sets none', () => {
        const service = new McpToolSerializerService(configWithPrecision(undefined));
        expect(service.variant({ id: 1, price: 25199, priceWithTax: 25199 } as any)).toMatchObject({
            priceDecimal: '251.99',
        });
    });

    it('scales order totals and line prices', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        expect(
            service.order({
                id: 1,
                code: 'T_1',
                state: 'AddingItems',
                active: true,
                total: 20999,
                totalWithTax: 25199,
                currencyCode: 'USD',
                totalQuantity: 1,
                discounts: [],
                lines: [{ id: 5, quantity: 1, linePriceWithTax: 25199, productVariant: null }],
            } as any),
        ).toMatchObject({
            totalDecimal: '209.99',
            totalWithTaxDecimal: '251.99',
            lines: [{ linePriceWithTaxDecimal: '251.99' }],
        });
    });

    it('scales a zero amount to a zero-padded decimal', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        expect(service.variant({ id: 1, price: 0, priceWithTax: 0 } as any)).toMatchObject({
            priceDecimal: '0.00',
            priceWithTaxDecimal: '0.00',
        });
    });

    it('keeps the sign on a negative amount', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        expect(service.variant({ id: 1, price: -500, priceWithTax: -500 } as any)).toMatchObject({
            priceDecimal: '-5.00',
            priceWithTaxDecimal: '-5.00',
        });
    });

    it('does not print a negative zero when a fractional amount rounds toward zero', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        expect(service.variant({ id: 1, price: -0.4, priceWithTax: -0.4 } as any)).toMatchObject({
            priceDecimal: '0.00',
            priceWithTaxDecimal: '0.00',
        });
    });

    it('rounds a fractional amount before scaling it', () => {
        const service = new McpToolSerializerService(configWithPrecision(2));
        expect(service.variant({ id: 1, price: 20999.6, priceWithTax: 20999.6 } as any)).toMatchObject({
            priceDecimal: '210.00',
            priceWithTaxDecimal: '210.00',
        });
    });
});
