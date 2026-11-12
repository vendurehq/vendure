import { mergeConfig } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import path from 'path';
import { Logger as TypeOrmLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    BOX_SIZE,
    FIXED_UNIT_PRICE,
    fixedPriceEmailAddresses,
    TestShopperPricePlugin,
} from './fixtures/test-shopper-price-layer';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql, ResultOf } from './graphql/graphql-shop';
import { getCustomerListDocument } from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const GUEST_EMAIL_ADDRESS = 'guest-with-fixed-price@example.com';

const getVariantPricesDocument = graphql(`
    query GetVariantShopperPrices($id: ID!, $quantity: Int, $data: JSON) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
                shopperPrice(quantity: $quantity, data: $data) {
                    price
                    priceWithTax
                }
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

const orderLinesFragment = graphql(`
    fragment ShopperPriceOrderLines on Order {
        lines {
            quantity
            unitPrice
            unitPriceWithTax
            productVariant {
                id
            }
        }
    }
`);

const addItemDocument = graphql(
    `
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
                ...ShopperPriceOrderLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderLinesFragment],
);

const setCustomerForOrderDocument = graphql(`
    mutation SetGuestCustomerForShopperPrice($input: CreateCustomerInput!) {
        setCustomerForOrder(input: $input) {
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

const setShippingAddressDocument = graphql(`
    mutation SetShippingAddressForShopperPrice($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
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
type VariantPrices = NonNullable<ResultOf<typeof getVariantPricesDocument>['product']>['variants'];

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductVariant.shopperPrice with a custom ProductVariantShopperPriceStrategy', () => {
    /** The SQL queries that select from the customer table, since the count was last reset to 0. */
    let customerQueryCount = 0;
    const countingLogger: TypeOrmLogger = {
        logQuery: query => {
            if (/from ["`]customer["`]/i.test(query)) {
                customerQueryCount++;
            }
        },
        logQueryError: () => undefined,
        logQuerySlow: () => undefined,
        logSchemaBuild: () => undefined,
        logMigration: () => undefined,
        log: () => undefined,
    };
    const config = testConfig();
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(config, {
            plugins: [TestShopperPricePlugin],
            customFields: {
                OrderLine: [{ name: 'unitCode', type: 'string' }],
            },
            dbConnectionOptions: {
                ...config.dbConnectionOptions,
                logging: ['query'],
                logger: countingLogger,
            },
        }),
    );
    const orderGuard: ErrorResultGuard<OrderResult> = createErrorResultGuard(input => !!input.lines);

    let fixedPriceCustomer: { id: string; emailAddress: string };
    /** The variants of the first product, with the channel prices. */
    let channelPrices: VariantPrices;

    async function addToCart(
        client: SimpleGraphQLClient,
        variantId: string,
        quantity: number,
        customFields?: Record<string, unknown>,
    ) {
        const { addItemToOrder } = await client.query(addItemDocument, {
            productVariantId: variantId,
            quantity,
            // The generated shop types declare no fields for OrderLineCustomFieldsInput.
            customFields: customFields as never,
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
        fixedPriceCustomer = customers.items[0];
        fixedPriceEmailAddresses.add(fixedPriceCustomer.emailAddress);
        fixedPriceEmailAddresses.add(GUEST_EMAIL_ADDRESS);
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        channelPrices = product!.variants;
        await shopClient.asUserWithCredentials(fixedPriceCustomer.emailAddress, 'test');
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

        product!.variants.forEach((variant, i) => {
            expect(variant.price).toBe(channelPrices[i].price);
            expect(variant.priceWithTax).toBe(channelPrices[i].priceWithTax);
        });
    });

    it('does not pass the change of one calculation on to the next', async () => {
        // The strategy writes to the variant that it receives. The shared entity must not change.
        // Without the fixed price, the strategy calculates from the listPrice of the variant.
        await shopClient.asAnonymousUser();
        const { product } = await shopClient.query(getTwiceShopperPriceDocument, { id: 'T_1' });
        await shopClient.asUserWithCredentials(fixedPriceCustomer.emailAddress, 'test');

        product!.variants.forEach((variant, i) => {
            expect(variant.first.price).toBe(Math.round(channelPrices[i].price * 0.8));
            expect(variant.second.price).toBe(variant.first.price);
        });
    });

    it('equals the unit price of the cart line for the same customer and quantity', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        const variant = product!.variants[0];

        const line = await addToCart(shopClient, variant.id, 1);

        expect(line.unitPrice).toBe(variant.shopperPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.shopperPrice.priceWithTax);
    });

    it('equals the unit price of the cart line for quantity 10', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 10 });
        const variant = product!.variants[1];

        expect(variant.shopperPrice.price).toBe(Math.round(FIXED_UNIT_PRICE * 0.8));

        const line = await addToCart(shopClient, variant.id, 10);

        expect(line.quantity).toBe(10);
        expect(line.unitPrice).toBe(variant.shopperPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.shopperPrice.priceWithTax);
    });

    it('equals the unit price of the cart line when a layer maps the OrderLine custom fields to data', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, {
            id: 'T_1',
            quantity: 2,
            data: { unitCode: 'BOX' },
        });
        const variant = product!.variants[2];

        expect(variant.shopperPrice.price).toBe(FIXED_UNIT_PRICE * BOX_SIZE);

        const line = await addToCart(shopClient, variant.id, 2, { unitCode: 'BOX' });

        expect(line.unitPrice).toBe(variant.shopperPrice.price);
        expect(line.unitPriceWithTax).toBe(variant.shopperPrice.priceWithTax);
    });

    it('returns the channel price for a guest session', async () => {
        await shopClient.asAnonymousUser();
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });

        for (const variant of product!.variants) {
            expect(variant.shopperPrice).toEqual({
                price: variant.price,
                priceWithTax: variant.priceWithTax,
            });
        }
    });

    it('uses the guest customer of the order in the cart', async () => {
        // The session is still anonymous
        const firstLine = await addToCart(shopClient, channelPrices[0].id, 1);
        expect(firstLine.unitPrice).toBe(channelPrices[0].price);

        await shopClient.query(setCustomerForOrderDocument, {
            input: { emailAddress: GUEST_EMAIL_ADDRESS, firstName: 'Guest', lastName: 'Shopper' },
        });
        const secondLine = await addToCart(shopClient, channelPrices[1].id, 1);

        expect(secondLine.unitPrice).toBe(FIXED_UNIT_PRICE);
        // The session has no Customer, so the shopper price is the channel price
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        expect(product!.variants[1].shopperPrice.price).toBe(channelPrices[1].price);
    });

    it('loads the customer once for each request, not once for each order line', async () => {
        const address = { streetLine1: '1 Test Street', countryCode: 'GB' };
        const countCustomerQueries = async () => {
            customerQueryCount = 0;
            await shopClient.query(setShippingAddressDocument, { input: address });
            return customerQueryCount;
        };
        // The guest order of the previous test has 2 lines
        const withTwoLines = await countCustomerQueries();
        await addToCart(shopClient, channelPrices[2].id, 1);
        await addToCart(shopClient, channelPrices[3].id, 1);
        const withFourLines = await countCustomerQueries();

        expect(withTwoLines).toBeGreaterThan(0);
        expect(withFourLines).toBe(withTwoLines);
    });

    it('uses the customer of the order in an Admin draft order', async () => {
        const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
        await adminClient.query(setCustomerForDraftOrderDocument, {
            orderId: createDraftOrder.id,
            customerId: fixedPriceCustomer.id,
        });
        const { addItemToDraftOrder } = await adminClient.query(addItemToDraftOrderDocument, {
            orderId: createDraftOrder.id,
            input: { productVariantId: channelPrices[3].id, quantity: 1 },
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
