import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { InsufficientStockError, Order, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { McpToolSerializerService } from './serializer.service';

/** Callers for the custom field rules: an administrator with every permission, and a shopper. */
const adminCtx = { apiType: 'admin', userHasPermissions: () => true } as unknown as RequestContext;
const shopCtx = { apiType: 'shop', userHasPermissions: () => false } as unknown as RequestContext;

/** A stand-in for Vendure's ConfigService carrying only what the serializer reads. */
function configWithPrecision(precision: number | undefined) {
    return { entityOptions: { moneyStrategy: { precision } }, customFields: {} } as any;
}

/**
 * The same four custom field configs on both quote entities: one a shop caller may see, and three
 * that must never reach one.
 */
function configWithQuoteCustomFields() {
    const fields = [
        { name: 'trackingUrl', type: 'string' },
        { name: 'internalNote', type: 'string', internal: true },
        { name: 'adminOnly', type: 'string', public: false },
        { name: 'gated', type: 'string', requiresPermission: 'ReadSettings' },
    ];
    return {
        entityOptions: { moneyStrategy: { precision: 2 } },
        customFields: { ShippingMethod: fields, PaymentMethod: fields },
    } as any;
}

describe('McpToolSerializerService', () => {
    const service = new McpToolSerializerService(configWithPrecision(2));

    it('serializes a variant with the same fields the old function returned', () => {
        expect(
            service.variant(adminCtx, {
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

    it('adds stock on hand to the admin variant shape', () => {
        expect(
            service.adminVariant(
                adminCtx,
                { id: 27, sku: 'IC-27', price: 100, priceWithTax: 120 } as any,
                40,
            ),
        ).toMatchObject({
            id: 27,
            sku: 'IC-27',
            priceDecimal: '1.00',
            priceWithTaxDecimal: '1.20',
            stockOnHand: 40,
        });
    });

    it('serializes a product list item with a reduced asset, description, and price range', () => {
        const longDescription = 'x'.repeat(250);
        const asset = { id: 3, preview: 'preview.jpg', source: 'source.jpg', width: 800 };
        const item = service.productListItem(
            {
                id: 1,
                name: 'Shirt',
                slug: 'shirt',
                description: longDescription,
                enabled: true,
                featuredAsset: asset,
            } as any,
            [
                { priceWithTax: 720, currencyCode: 'USD' },
                { priceWithTax: 600, currencyCode: 'USD' },
                { priceWithTax: 840, currencyCode: 'USD' },
            ] as any,
        );
        expect(item).toMatchObject({
            description: `${'x'.repeat(200)}...`,
            featuredAsset: { id: 3, preview: 'preview.jpg' },
            priceRange: {
                min: 600,
                minDecimal: '6.00',
                max: 840,
                maxDecimal: '8.40',
                currencyCode: 'USD',
            },
        });
    });

    it('returns null for a missing variant or order', () => {
        expect(service.variant(adminCtx, null)).toBeNull();
        expect(service.order(adminCtx, undefined)).toBeNull();
    });

    it('passes a Vendure error result straight through instead of serializing it', () => {
        const errorResult = {
            __typename: 'OrderLimitError',
            errorCode: 'ORDER_LIMIT_ERROR',
            message: 'Too many items',
        };
        // Returned bare, not wrapped: the registry recognises a Vendure error result at the top
        // level of a tool's output and reports the call as failed.
        expect(service.orderOrError(adminCtx, errorResult)).toEqual(errorResult);
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

    it('omits the address book unless the caller passes it', () => {
        const serialized = service.customer(adminCtx, {
            id: 4,
            firstName: 'Ada',
            lastName: 'Lovelace',
            emailAddress: 'ada@example.test',
            phoneNumber: '555-0100',
            // Core loads this relation for reasons of its own - a customer list filtered by
            // postalCode does it - and those rows carry no country, so they are not used here.
            addresses: [{ id: 9, streetLine1: '12 Test Street' }],
        } as any);

        expect(serialized).toEqual({
            id: 4,
            firstName: 'Ada',
            lastName: 'Lovelace',
            emailAddress: 'ada@example.test',
            phoneNumber: '555-0100',
            addresses: undefined,
        });
        expect('addresses' in JSON.parse(JSON.stringify(serialized))).toBe(false);
    });

    it("serializes the addresses it is given, with each address's default flags", () => {
        const serialized = service.customer(
            adminCtx,
            {
                id: 4,
                firstName: 'Ada',
                lastName: 'Lovelace',
                emailAddress: 'ada@example.test',
                phoneNumber: '555-0100',
            } as any,
            [
                {
                    id: 9,
                    fullName: 'Ada Lovelace',
                    company: '',
                    streetLine1: '12 Test Street',
                    streetLine2: '',
                    city: 'London',
                    province: '',
                    postalCode: 'N1 1AA',
                    phoneNumber: '',
                    country: { code: 'GB' },
                    defaultShippingAddress: true,
                    defaultBillingAddress: true,
                },
            ] as any,
        );

        expect(serialized?.addresses).toEqual([
            {
                id: 9,
                fullName: 'Ada Lovelace',
                company: '',
                streetLine1: '12 Test Street',
                streetLine2: '',
                city: 'London',
                province: '',
                postalCode: 'N1 1AA',
                countryCode: 'GB',
                phoneNumber: '',
                defaultShippingAddress: true,
                defaultBillingAddress: true,
            },
        ]);
    });

    it('serializes a shipping quote without dropping calculator data', () => {
        const quoteService = new McpToolSerializerService({
            entityOptions: { moneyStrategy: { precision: 2 } },
            customFields: { ShippingMethod: [{ name: 'warehouse', type: 'string' }] },
        } as any);
        expect(
            quoteService.shippingQuote(
                shopCtx,
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
        ).toEqual({
            id: 1,
            code: 'standard-shipping',
            name: 'Standard Shipping',
            description: '',
            price: 500,
            priceDecimal: '5.00',
            priceWithTax: 600,
            priceWithTaxDecimal: '6.00',
            currencyCode: 'GBP',
            metadata: { carrier: 'Royal Mail' },
            customFields: { warehouse: 'north' },
        });
    });

    it("turns an order's dates into ISO strings", () => {
        const serialized = service.order(adminCtx, {
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
        const serialized = service.order(adminCtx, {
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
                { id: 5, method: 'cash', amount: 100, state: 'Settled', metadata: {} },
            ],
        } as any);

        expect(serialized?.payments?.[0]).toEqual({
            id: 4,
            method: 'redirect-payment',
            amount: 25199,
            amountDecimal: '251.99',
            state: 'Created',
            transactionId: 'tx-1',
            errorMessage: undefined,
            publicMetadata: { redirectUrl: 'https://pay.example.com/x' },
            refunds: undefined,
        });
        expect(JSON.stringify(serialized)).not.toContain('hidden');
        expect(serialized?.payments?.[1].publicMetadata).toBeNull();
    });

    it("serializes an order's shipping lines, and omits them when the relation was not loaded", () => {
        const withLines = service.order(adminCtx, {
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

        const withoutRelation = service.order(adminCtx, {
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            discounts: [],
        } as any);
        expect(withoutRelation?.shippingLines).toBeUndefined();
    });

    it("names an order's customer, answers null for a cart with nobody on it, and omits the key when the relation was not loaded", () => {
        const withCustomer = service.order(adminCtx, {
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            discounts: [],
            customer: {
                id: 7,
                emailAddress: 'jane@example.com',
                firstName: 'Jane',
                lastName: 'Doe',
                phoneNumber: '555',
            },
        } as any);
        // The order shape names the buyer and nothing more; `get_my_account` is where the rest of
        // a customer's details live.
        expect(withCustomer?.customer).toEqual({
            id: 7,
            emailAddress: 'jane@example.com',
            firstName: 'Jane',
            lastName: 'Doe',
        });

        // TypeORM sets the property to null when the relation was asked for and the order has
        // nobody on it, and leaves it undefined when the relation was never loaded.
        const anonymousCart = service.order(adminCtx, {
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            discounts: [],
            customer: null,
        } as any);
        expect(anonymousCart?.customer).toBeNull();

        const withoutRelation = service.order(adminCtx, {
            id: 1,
            code: 'T_1',
            state: 'AddingItems',
            lines: [],
            discounts: [],
        } as any);
        expect(withoutRelation?.customer).toBeUndefined();
    });

    it("lists a payment's refunds when the relation was loaded, and omits the key when it was not", () => {
        const withRefunds = service.payment({
            id: 4,
            method: 'cash',
            amount: 25199,
            state: 'Settled',
            metadata: {},
            refunds: [
                { id: 9, state: 'Settled', total: 5000, reason: 'Damaged' },
                { id: 10, state: 'Failed', total: 100 },
            ],
        } as any);
        expect(withRefunds.refunds).toEqual([
            { id: 9, state: 'Settled', total: 5000, totalDecimal: '50.00', reason: 'Damaged' },
            { id: 10, state: 'Failed', total: 100, totalDecimal: '1.00', reason: null },
        ]);

        const withoutRelation = service.payment({
            id: 4,
            method: 'cash',
            amount: 100,
            state: 'Settled',
        } as any);
        expect(withoutRelation.refunds).toBeUndefined();
        expect('refunds' in JSON.parse(JSON.stringify(withoutRelation))).toBe(false);
    });

    it('serializes a refund with the order currency and the payment it comes from', () => {
        expect(
            service.refund(
                { id: 9, state: 'Pending', total: 5000, reason: undefined, paymentId: 4 } as any,
                'USD' as any,
            ),
        ).toEqual({
            id: 9,
            state: 'Pending',
            total: 5000,
            totalDecimal: '50.00',
            currencyCode: 'USD',
            reason: null,
            paymentId: 4,
        });
    });

    it('serializes an order note from its history entry', () => {
        expect(
            service.orderNote({
                id: 12,
                data: { note: 'Customer asked for gift wrap' },
                isPublic: true,
                createdAt: new Date('2026-08-27T08:00:00.000Z'),
            } as any),
        ).toEqual({
            id: 12,
            text: 'Customer asked for gift wrap',
            isPublic: true,
            createdAt: '2026-08-27T08:00:00.000Z',
        });
    });

    it("gives an order's addresses as null when unset, whether missing or core's empty object", () => {
        const base = { id: 1, code: 'T_1', state: 'AddingItems', lines: [], discounts: [] };
        expect(
            service.order(adminCtx, { ...base, shippingAddress: {}, billingAddress: undefined } as any),
        ).toMatchObject({
            shippingAddress: null,
            billingAddress: null,
        });
    });

    it('leaves out the address fields that were not given', () => {
        const serialized = service.order(adminCtx, {
            id: 1,
            code: 'T_1',
            state: 'ArrangingPayment',
            lines: [],
            discounts: [],
            shippingAddress: {
                fullName: 'Ada Lovelace',
                streetLine1: '12 Test Street',
                city: 'London',
                postalCode: 'N1 1AA',
                countryCode: 'GB',
            },
        } as any);
        expect(serialized?.shippingAddress).toEqual({
            fullName: 'Ada Lovelace',
            streetLine1: '12 Test Street',
            city: 'London',
            postalCode: 'N1 1AA',
            countryCode: 'GB',
        });
    });

    it('omits payments when the relation was not loaded', () => {
        const serialized = service.order(adminCtx, {
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
            service.order(adminCtx, {
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
                    productVariant: { id: 27, name: 'Instant Camera', sku: 'IC-27' },
                },
            ],
            shippingAddress: null,
            billingAddress: null,
            shippingWithTax: undefined,
            shippingWithTaxDecimal: '0.00',
            shippingLines: undefined,
        });
    });

    it("lists an order's coupon codes and the discounts they earned", () => {
        const serialized = service.order(adminCtx, {
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
            adminCtx,
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

        expect(service.orderOrError(adminCtx, removed)).toEqual({
            ...removed,
            newTotalWithTaxDecimal: '251.99',
            previousTotalWithTaxDecimal: '226.79',
        });
    });
});

describe('money scaling', () => {
    it('honours a store configured for three decimal places', () => {
        const service = new McpToolSerializerService(configWithPrecision(3));
        expect(service.variant(adminCtx, { id: 1, price: 25199, priceWithTax: 25199 } as any)).toMatchObject({
            priceDecimal: '25.199',
        });
    });

    it('falls back to two decimal places when the store sets none', () => {
        const service = new McpToolSerializerService(configWithPrecision(undefined));
        expect(service.variant(adminCtx, { id: 1, price: 25199, priceWithTax: 25199 } as any)).toMatchObject({
            priceDecimal: '251.99',
        });
    });

    it('shows a shop caller only the custom fields the Shop API would show', () => {
        const quoteService = new McpToolSerializerService(configWithQuoteCustomFields());
        const customFields = {
            trackingUrl: 'https://track.example.test',
            internalNote: 'secret',
            adminOnly: 'staff only',
            gated: 'permission only',
            strayKey: 'not declared',
        };

        const shipping = quoteService.shippingQuote(
            shopCtx,
            { id: 1, price: 500, priceWithTax: 600, metadata: { carrier: 'DHL' }, customFields } as any,
            'USD' as any,
        );
        expect(shipping.customFields).toEqual({ trackingUrl: 'https://track.example.test' });
        expect(shipping.metadata).toEqual({ carrier: 'DHL' });
        expect(shipping.priceWithTaxDecimal).toBe('6.00');

        const payment = quoteService.paymentQuote(shopCtx, { id: 2, code: 'card', customFields } as any);
        expect(payment.customFields).toEqual({ trackingUrl: 'https://track.example.test' });
        expect(payment.code).toBe('card');
    });

    it('passes a quote with no custom fields through untouched', () => {
        const quoteService = new McpToolSerializerService(configWithQuoteCustomFields());
        expect(
            quoteService.shippingQuote(shopCtx, { id: 1, price: 0, priceWithTax: 0 } as any, 'USD' as any)
                .customFields,
        ).toBeUndefined();
        expect(
            quoteService.paymentQuote(shopCtx, { id: 2, code: 'card' } as any).customFields,
        ).toBeUndefined();
    });
});

// #5656 — tool outputs carry the custom fields the caller may read, by the rules of the GraphQL API
describe('custom fields', () => {
    const fields = [
        { name: 'material', type: 'string' },
        { name: 'internalCode', type: 'string', internal: true },
        { name: 'lockedCode', type: 'string', readonly: true },
        { name: 'oldCode', type: 'string', deprecated: true },
        { name: 'tagline', type: 'localeString' },
        { name: 'tags', type: 'string', list: true },
        { name: 'dimensions', type: 'struct', fields: [{ name: 'width', type: 'int' }] },
        { name: 'launchedAt', type: 'datetime' },
        { name: 'restockDates', type: 'datetime', list: true },
        { name: 'staffNote', type: 'string', public: false },
        { name: 'margin', type: 'int', requiresPermission: 'ReadSettings' },
        { name: 'badge', type: 'string', public: true, requiresPermission: 'ReadSettings' },
        { name: 'apiKey', type: 'string', secret: true },
        { name: 'supplier', type: 'relation', entity: {} },
        { name: 'related', type: 'relation', list: true, entity: {} },
    ];
    const service = new McpToolSerializerService({
        entityOptions: { moneyStrategy: { precision: 2 } },
        customFields: { Product: fields, Order: fields, OrderLine: [{ name: 'engraving', type: 'string' }] },
    } as any);
    const values = {
        material: 'Oak',
        internalCode: 'X-1',
        lockedCode: 'L-1',
        oldCode: 'O-1',
        tagline: 'Sit well',
        tags: ['wood', 'chair'],
        dimensions: { width: 40 },
        launchedAt: new Date('2026-01-02T03:04:05.000Z'),
        restockDates: [new Date('2026-02-01T00:00:00.000Z')],
        staffNote: 'fragile',
        margin: 40,
        badge: 'new',
        apiKey: 'sk-live-1',
        supplier: { id: 7, name: 'Loaded relation' },
        supplierId: 7,
        related: [{ id: 8 }],
        __fix_relational_custom_fields__: null,
    };
    const product = { id: 1, name: 'Chair', customFields: values } as any;

    it('shows an administrator every field but internal ones, including readonly and deprecated ones, with secrets redacted and relations as IDs', () => {
        expect(service.product(adminCtx, product)?.customFields).toEqual({
            material: 'Oak',
            lockedCode: 'L-1',
            oldCode: 'O-1',
            tagline: 'Sit well',
            tags: ['wood', 'chair'],
            dimensions: { width: 40 },
            launchedAt: '2026-01-02T03:04:05.000Z',
            restockDates: ['2026-02-01T00:00:00.000Z'],
            staffNote: 'fragile',
            margin: 40,
            badge: 'new',
            apiKey: REDACTED_SECRET_PLACEHOLDER,
            supplierId: 7,
        });
    });

    it('hides a field from an administrator without its required permission', () => {
        const limitedCtx = { apiType: 'admin', userHasPermissions: () => false } as unknown as RequestContext;
        expect(service.product(limitedCtx, product)?.customFields).toEqual({
            material: 'Oak',
            lockedCode: 'L-1',
            oldCode: 'O-1',
            tagline: 'Sit well',
            tags: ['wood', 'chair'],
            dimensions: { width: 40 },
            launchedAt: '2026-01-02T03:04:05.000Z',
            restockDates: ['2026-02-01T00:00:00.000Z'],
            staffNote: 'fragile',
            apiKey: REDACTED_SECRET_PLACEHOLDER,
            supplierId: 7,
        });
    });

    it('shows a shopper the public fields, and a permission-gated one only when it is explicitly public', () => {
        expect(service.product(shopCtx, product)?.customFields).toEqual({
            material: 'Oak',
            lockedCode: 'L-1',
            oldCode: 'O-1',
            tagline: 'Sit well',
            tags: ['wood', 'chair'],
            dimensions: { width: 40 },
            launchedAt: '2026-01-02T03:04:05.000Z',
            restockDates: ['2026-02-01T00:00:00.000Z'],
            badge: 'new',
            apiKey: REDACTED_SECRET_PLACEHOLDER,
            supplierId: 7,
        });
    });

    it('gives an unset field as null, and an unset secret as null rather than the placeholder', () => {
        expect(service.product(adminCtx, { id: 1, customFields: {} } as any)?.customFields).toEqual({
            material: null,
            lockedCode: null,
            oldCode: null,
            tagline: null,
            tags: null,
            dimensions: null,
            launchedAt: null,
            restockDates: null,
            staffNote: null,
            margin: null,
            badge: null,
            apiKey: null,
            supplierId: null,
        });
    });

    it('gives no custom fields for an entity which has none configured', () => {
        const serialized = service.variant(adminCtx, {
            id: 1,
            price: 100,
            priceWithTax: 120,
            customFields: {},
        } as any);
        expect(serialized?.customFields).toBeUndefined();
    });

    it('gives the custom fields of an order and of its lines', () => {
        const serialized = service.order(adminCtx, {
            id: 1,
            discounts: [],
            customFields: { material: 'Oak' },
            lines: [{ id: 2, quantity: 1, linePriceWithTax: 100, customFields: { engraving: 'For Sam' } }],
        } as any);
        expect(serialized?.customFields).toMatchObject({ material: 'Oak' });
        expect(serialized?.lines[0].customFields).toEqual({ engraving: 'For Sam' });
    });
});
