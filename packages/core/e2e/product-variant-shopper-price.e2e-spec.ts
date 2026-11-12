import { composeStrategy, DefaultProductVariantShopperPriceStrategy, mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    BOX_SIZE,
    FIXED_UNIT_PRICE,
    fixedPriceCustomer,
    TestShopperPriceLayer,
} from './fixtures/test-shopper-price-layer';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql, ResultOf } from './graphql/graphql-shop';
import { getCustomerListDocument } from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const getVariantPricesDocument = graphql(`
    query GetVariantShopperPrices($id: ID!, $quantity: Int) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
                shopperPrice(quantity: $quantity) {
                    price
                    priceWithTax
                }
            }
        }
    }
`);

const getVariantPricesWithCustomFieldsDocument = graphql(`
    query GetVariantShopperPricesWithCustomFields(
        $id: ID!
        $quantity: Int
        $customFields: OrderLineCustomFieldsInput
    ) {
        product(id: $id) {
            variants {
                id
                shopperPrice(quantity: $quantity, customFields: $customFields) {
                    price
                    priceWithTax
                }
            }
        }
    }
`);

const getVariantChannelPricesDocument = graphql(`
    query GetVariantChannelPrices($id: ID!) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
            }
        }
    }
`);

const getTwiceShopperPriceDocument = graphql(`
    query GetTwiceShopperPrice($id: ID!) {
        product(id: $id) {
            variants {
                first: shopperPrice(quantity: 10) {
                    price
                }
                second: shopperPrice(quantity: 10) {
                    price
                }
            }
        }
    }
`);

const getShopperPriceArgsDocument = graphql(`
    query GetShopperPriceArgs {
        __type(name: "ProductVariant") {
            fields {
                name
                args {
                    name
                }
            }
        }
    }
`);

const addItemDocument = graphql(`
    mutation AddItemForShopperPrice(
        $productVariantId: ID!
        $quantity: Int!
        $customFields: OrderLineCustomFieldsInput
    ) {
        addItemToOrder(
            productVariantId: $productVariantId
            quantity: $quantity
            customFields: $customFields
        ) {
            ... on Order {
                lines {
                    quantity
                    unitPrice
                    unitPriceWithTax
                    productVariant {
                        id
                    }
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const createDraftOrderDocument = adminGraphql(`
    mutation CreateDraftOrderForShopperPrice {
        createDraftOrder {
            id
        }
    }
`);

const setCustomerForDraftOrderDocument = adminGraphql(`
    mutation SetCustomerForDraftOrderForShopperPrice($orderId: ID!, $customerId: ID!) {
        setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId) {
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const addItemToDraftOrderDocument = adminGraphql(`
    mutation AddItemToDraftOrderForShopperPrice($orderId: ID!, $input: AddItemToDraftOrderInput!) {
        addItemToDraftOrder(orderId: $orderId, input: $input) {
            ... on Order {
                lines {
                    unitPrice
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

type AddItemResult = ResultOf<typeof addItemDocument>['addItemToOrder'];
type OrderResult = Extract<AddItemResult, { lines: unknown }>;

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductVariant.shopperPrice with a custom ProductVariantShopperPriceStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                OrderLine: [{ name: 'unitCode', type: 'string' }],
            },
            catalogOptions: {
                productVariantShopperPriceStrategy: composeStrategy(
                    TestShopperPriceLayer,
                    new DefaultProductVariantShopperPriceStrategy(),
                ),
            },
        }),
    );
    const orderGuard: ErrorResultGuard<OrderResult> = createErrorResultGuard(input => !!input.lines);

    let fixedPriceCustomerId: string;
    let channelPrices: ResultOf<typeof getVariantChannelPricesDocument>['product'];

    async function addToCart(variantId: string, quantity: number, customFields?: Record<string, any>) {
        const { addItemToOrder } = await shopClient.query(addItemDocument, {
            productVariantId: variantId,
            quantity,
            customFields,
        });
        orderGuard.assertSuccess(addItemToOrder);
        const line = addItemToOrder.lines.find(l => l.productVariant.id === variantId);
        if (!line) {
            throw new Error(`No order line for variant ${variantId}`);
        }
        return line;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 1 } });
        fixedPriceCustomer.emailAddress = customers.items[0].emailAddress;
        fixedPriceCustomerId = customers.items[0].id;
        await shopClient.asUserWithCredentials(fixedPriceCustomer.emailAddress, 'test');
        ({ product: channelPrices } = await shopClient.query(getVariantChannelPricesDocument, { id: 'T_1' }));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('returns the price of the strategy for the active customer', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        const variant = product!.variants[0];

        expect(variant.shopperPrice.price).toBe(FIXED_UNIT_PRICE);
        expect(variant.shopperPrice.price).not.toBe(variant.price);
    });

    it('does not change price and priceWithTax', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 10 });

        expect(
            product!.variants.map(v => ({ id: v.id, price: v.price, priceWithTax: v.priceWithTax })),
        ).toEqual(channelPrices!.variants);
    });

    it('does not pass the change of one calculation on to the next', async () => {
        // The strategy writes to the variant that it receives. The shared entity must not change.
        // Without the fixed price, the strategy calculates from the listPrice of the variant.
        await shopClient.asAnonymousUser();
        const { product } = await shopClient.query(getTwiceShopperPriceDocument, { id: 'T_1' });
        await shopClient.asUserWithCredentials(fixedPriceCustomer.emailAddress, 'test');

        product!.variants.forEach((variant, i) => {
            expect(variant.first.price).toBe(Math.round(channelPrices!.variants[i].price * 0.8));
            expect(variant.second.price).toBe(variant.first.price);
        });
    });

    it('equals the unit price of the cart line for the same customer and quantity', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        const variant = product!.variants[0];

        const line = await addToCart(variant.id, 1);

        expect(line.unitPrice).toBe(variant.shopperPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.shopperPrice.priceWithTax);
    });

    it('equals the unit price of the cart line for quantity 10', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 10 });
        const variant = product!.variants[1];

        expect(variant.shopperPrice.price).toBe(Math.round(FIXED_UNIT_PRICE * 0.8));

        const line = await addToCart(variant.id, 10);

        expect(line.quantity).toBe(10);
        expect(line.unitPrice).toBe(variant.shopperPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.shopperPrice.priceWithTax);
    });

    it('equals the unit price of the cart line for the same OrderLine custom fields', async () => {
        const customFields = { unitCode: 'BOX' };
        const { product } = await shopClient.query(getVariantPricesWithCustomFieldsDocument, {
            id: 'T_1',
            quantity: 2,
            customFields,
        });
        const variant = product!.variants[2];

        expect(variant.shopperPrice.price).toBe(FIXED_UNIT_PRICE * BOX_SIZE);

        const line = await addToCart(variant.id, 2, customFields);

        expect(line.unitPrice).toBe(variant.shopperPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.shopperPrice.priceWithTax);
    });

    it('has a customFields argument when OrderLine custom fields are defined', async () => {
        const { __type } = await shopClient.query(getShopperPriceArgsDocument);
        const field = __type!.fields!.find(f => f.name === 'shopperPrice');

        expect(field!.args.map(a => a.name)).toEqual(['quantity', 'customFields']);
    });

    it('returns the channel price for a customer without a special price', async () => {
        await shopClient.asAnonymousUser();
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });

        for (const variant of product!.variants) {
            expect(variant.shopperPrice).toEqual({
                price: variant.price,
                priceWithTax: variant.priceWithTax,
            });
        }
    });

    it('uses the customer of the order in an Admin draft order', async () => {
        const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
        await adminClient.query(setCustomerForDraftOrderDocument, {
            orderId: createDraftOrder.id,
            customerId: fixedPriceCustomerId,
        });
        const { addItemToDraftOrder } = await adminClient.query(addItemToDraftOrderDocument, {
            orderId: createDraftOrder.id,
            input: { productVariantId: channelPrices!.variants[3].id, quantity: 1 },
        });

        expect(addItemToDraftOrder).toEqual({ lines: [{ unitPrice: FIXED_UNIT_PRICE }] });
    });

    it(
        'rejects a quantity of 0',
        assertThrowsWithMessage(
            () => shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 0 }),
            'The quantity for the shopper price must be a positive integer',
        ),
    );

    it(
        'rejects a negative quantity',
        assertThrowsWithMessage(
            () => shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: -1 }),
            'The quantity for the shopper price must be a positive integer',
        ),
    );
});
