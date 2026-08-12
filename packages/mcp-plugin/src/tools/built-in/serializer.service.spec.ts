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
        const errorResult = { __typename: 'OrderLimitError', message: 'Too many items' };
        expect(service.orderOrError(errorResult)).toEqual({ result: errorResult });
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
