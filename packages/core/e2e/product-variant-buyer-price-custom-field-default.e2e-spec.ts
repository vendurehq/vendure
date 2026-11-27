import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { BOX_SIZE, TestBuyerPricePlugin } from './fixtures/test-buyer-price-layer';
import { graphql } from './graphql/graphql-shop';

const buyerPriceDocument = graphql(`
    query GetBuyerPriceWithCustomFieldDefault(
        $productVariantId: ID!
        $quantity: Int
        $customFields: OrderLineCustomFieldsInput
    ) {
        buyerPrice(productVariantId: $productVariantId, quantity: $quantity, customFields: $customFields) {
            price
        }
    }
`);

const buyerPricesDocument = graphql(`
    query GetBuyerPricesWithCustomFieldDefault($input: [BuyerPriceInput!]!) {
        buyerPrices(input: $input) {
            price
        }
    }
`);

const getVariantsDocument = graphql(`
    query GetVariantsWithCustomFieldDefault($id: ID!) {
        product(id: $id) {
            variants {
                id
                price
            }
        }
    }
`);

const addItemDocument = graphql(`
    mutation AddItemWithCustomFieldDefault(
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
                    unitPrice
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

// The generated shop types declare no fields for OrderLineCustomFieldsInput and BuyerPriceInput.
const customFieldsInput = (input: Record<string, unknown>) => input as never;
const buyerPriceInputs = (
    inputs: Array<{ productVariantId: string; quantity?: number; customFields?: Record<string, unknown> }>,
) => inputs as never[];

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('The buyerPrice and buyerPrices queries with an OrderLine custom field that has a default value', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TestBuyerPricePlugin],
            customFields: {
                // The test strategy gives the price of a box when the pricing data has `unitCode: 'BOX'`.
                OrderLine: [{ name: 'unitCode', type: 'string', defaultValue: 'BOX' }],
            },
        }),
    );
    let variantIds: string[];
    let channelPrice: number;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { product } = await shopClient.query(getVariantsDocument, { id: 'T_1' });
        variantIds = product!.variants.map(v => v.id);
        channelPrice = product!.variants[0].price;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function addItemAndGetUnitPrice(productVariantId: string, customFields?: Record<string, unknown>) {
        const { addItemToOrder } = await shopClient.query(addItemDocument, {
            productVariantId,
            quantity: 1,
            customFields: customFields && customFieldsInput(customFields),
        });
        if (!('lines' in addItemToOrder)) {
            throw new Error(addItemToOrder.message);
        }
        return addItemToOrder.lines.find(line => line.productVariant.id === productVariantId)!.unitPrice;
    }

    it('equals the unit price of the cart line when the input leaves out the field', async () => {
        await shopClient.asAnonymousUser();
        const { buyerPrice } = await shopClient.query(buyerPriceDocument, {
            productVariantId: variantIds[0],
            quantity: 1,
        });
        const { buyerPrices } = await shopClient.query(buyerPricesDocument, {
            input: buyerPriceInputs([
                { productVariantId: variantIds[0], quantity: 1 },
                { productVariantId: variantIds[0], quantity: 1, customFields: {} },
            ]),
        });
        const unitPrice = await addItemAndGetUnitPrice(variantIds[0]);

        expect(unitPrice).toBe(channelPrice * BOX_SIZE);
        expect(buyerPrice!.price).toBe(unitPrice);
        expect(buyerPrices.map(result => result!.price)).toEqual([unitPrice, unitPrice]);
    });

    it('equals the unit price of the cart line when the input sets the field to null or to a value', async () => {
        await shopClient.asAnonymousUser();
        const { buyerPrices } = await shopClient.query(buyerPricesDocument, {
            input: buyerPriceInputs([
                { productVariantId: variantIds[1], quantity: 1, customFields: { unitCode: null } },
                { productVariantId: variantIds[2], quantity: 1, customFields: { unitCode: 'PIECE' } },
            ]),
        });
        const nullUnitPrice = await addItemAndGetUnitPrice(variantIds[1], { unitCode: null });
        const pieceUnitPrice = await addItemAndGetUnitPrice(variantIds[2], { unitCode: 'PIECE' });

        expect(buyerPrices.map(result => result!.price)).toEqual([nullUnitPrice, pieceUnitPrice]);
    });
});
