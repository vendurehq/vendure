import { mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    calculatedPriceStrategyCalls,
    FIXED_UNIT_PRICE,
    fixedPriceUser,
    TestCalculatedPriceStrategy,
} from './fixtures/test-calculated-price-strategy';
import { graphql, ResultOf } from './graphql/graphql-shop';
import { getCustomerListDocument } from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const getVariantPricesDocument = graphql(`
    query GetVariantCalculatedPrices($id: ID!, $quantity: Int) {
        product(id: $id) {
            variants {
                id
                calculatedPrice(quantity: $quantity) {
                    price
                    priceWithTax
                }
                price
                priceWithTax
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

const getTwiceCalculatedPriceDocument = graphql(`
    query GetTwiceCalculatedPrice($id: ID!) {
        product(id: $id) {
            variants {
                first: calculatedPrice(quantity: 10) {
                    price
                }
                second: calculatedPrice(quantity: 10) {
                    price
                }
            }
        }
    }
`);

const addItemDocument = graphql(`
    mutation AddItemForCalculatedPrice($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
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

type AddItemResult = ResultOf<typeof addItemDocument>['addItemToOrder'];
type OrderResult = Extract<AddItemResult, { lines: unknown }>;

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductVariant.calculatedPrice with a custom OrderItemPriceCalculationStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                orderItemPriceCalculationStrategy: new TestCalculatedPriceStrategy(),
            },
        }),
    );
    const orderGuard: ErrorResultGuard<OrderResult> = createErrorResultGuard(input => !!input.lines);

    let channelPrices: ResultOf<typeof getVariantChannelPricesDocument>['product'];

    async function addToCart(variantId: string, quantity: number) {
        const { addItemToOrder } = await shopClient.query(addItemDocument, {
            productVariantId: variantId,
            quantity,
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
        fixedPriceUser.identifier = customers.items[0].emailAddress;
        await shopClient.asUserWithCredentials(fixedPriceUser.identifier, 'test');
        ({ product: channelPrices } = await shopClient.query(getVariantChannelPricesDocument, { id: 'T_1' }));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('returns the price of the strategy for the active customer', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        const variant = product!.variants[0];

        expect(variant.calculatedPrice.price).toBe(FIXED_UNIT_PRICE);
        expect(variant.calculatedPrice.price).not.toBe(variant.price);
    });

    it('passes no order to the strategy', async () => {
        calculatedPriceStrategyCalls.length = 0;
        await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 3 });

        const variantCount = channelPrices!.variants.length;
        expect(calculatedPriceStrategyCalls).toEqual(
            Array.from({ length: variantCount }, () => ({ quantity: 3, hasOrder: false })),
        );
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
        const { product } = await shopClient.query(getTwiceCalculatedPriceDocument, { id: 'T_1' });
        await shopClient.asUserWithCredentials(fixedPriceUser.identifier, 'test');

        product!.variants.forEach((variant, i) => {
            expect(variant.first.price).toBe(Math.round(channelPrices!.variants[i].price * 0.8));
            expect(variant.second.price).toBe(variant.first.price);
        });
    });

    it('equals the unit price of the cart line for the same customer and quantity', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        const variant = product!.variants[0];

        const line = await addToCart(variant.id, 1);

        expect(line.unitPrice).toBe(variant.calculatedPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.calculatedPrice.priceWithTax);
    });

    it('equals the unit price of the cart line for quantity 10', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 10 });
        const variant = product!.variants[1];

        expect(variant.calculatedPrice.price).toBe(Math.round(FIXED_UNIT_PRICE * 0.8));

        const line = await addToCart(variant.id, 10);

        expect(line.quantity).toBe(10);
        expect(line.unitPrice).toBe(variant.calculatedPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.calculatedPrice.priceWithTax);
    });

    it('returns the channel price for a customer without a special price', async () => {
        await shopClient.asAnonymousUser();
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });

        for (const variant of product!.variants) {
            expect(variant.calculatedPrice).toEqual({
                price: variant.price,
                priceWithTax: variant.priceWithTax,
            });
        }
    });

    it(
        'rejects a quantity of 0',
        assertThrowsWithMessage(
            () => shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 0 }),
            'The quantity for the calculated price must be a positive integer',
        ),
    );

    it(
        'rejects a negative quantity',
        assertThrowsWithMessage(
            () => shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: -1 }),
            'The quantity for the calculated price must be a positive integer',
        ),
    );
});
