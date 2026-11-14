import { CurrencyCode } from '@vendure/common/lib/generated-types';
import {
    Asset,
    ConfigService,
    DefaultOrderItemPriceCalculationStrategy,
    getBaseStrategy,
    mergeConfig,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { Logger as TypeOrmLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    BOX_SIZE,
    buyerOverride,
    buyerPriceData,
    FIXED_UNIT_PRICE,
    fixedPriceEmailAddresses,
    noPriceSkus,
    noPriceSkusForFixedPriceCustomers,
    orderItemBuyerCustomerIds,
    orderItemMetadata,
    TestBuyerPricePlugin,
} from './fixtures/test-buyer-price-layer';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql, ResultOf } from './graphql/graphql-shop';
import {
    addManualPaymentDocument,
    adminTransitionToStateDocument,
    attemptLoginDocument,
    getCustomerListDocument,
    updateChannelDocument,
} from './graphql/shared-definitions';
import { setCurrencyCodeForOrderDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

// The generated shop types declare no fields for OrderLineCustomFieldsInput.
const customFieldsInput = (input: Record<string, unknown>) => input as never;

const GUEST_EMAIL_ADDRESS = 'guest-with-fixed-price@example.com';

const getVariantPricesDocument = graphql(`
    query GetVariantBuyerPrices($id: ID!, $quantity: Int, $customFields: OrderLineCustomFieldsInput) {
        product(id: $id) {
            variants {
                id
                sku
                price
                priceWithTax
                buyerPrice(quantity: $quantity, customFields: $customFields) {
                    price
                    priceWithTax
                }
            }
        }
    }
`);

const getTwiceBuyerPriceDocument = graphql(`
    query GetTwiceBuyerPrice($id: ID!) {
        product(id: $id) {
            variants {
                first: buyerPrice(quantity: 10) {
                    price
                }
                second: buyerPrice(quantity: 10) {
                    price
                }
            }
        }
    }
`);

const orderLinesFragment = graphql(`
    fragment BuyerPriceOrderLines on Order {
        lines {
            id
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
        mutation AddItemForBuyerPrice(
            $productVariantId: ID!
            $quantity: Int!
            $customFields: OrderLineCustomFieldsInput
        ) {
            addItemToOrder(
                productVariantId: $productVariantId
                quantity: $quantity
                customFields: $customFields
            ) {
                ...BuyerPriceOrderLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderLinesFragment],
);

const getActiveOrderLinesDocument = graphql(
    `
        query GetActiveOrderLinesForBuyerPrice {
            activeOrder {
                ...BuyerPriceOrderLines
            }
        }
    `,
    [orderLinesFragment],
);

const setCustomerForOrderDocument = graphql(`
    mutation SetGuestCustomerForBuyerPrice($input: CreateCustomerInput!) {
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

const adjustOrderLineDocument = graphql(
    `
        mutation AdjustOrderLineForBuyerPrice($orderLineId: ID!, $quantity: Int!) {
            adjustOrderLine(orderLineId: $orderLineId, quantity: $quantity) {
                ...BuyerPriceOrderLines
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `,
    [orderLinesFragment],
);

const setShippingAddressDocument = graphql(`
    mutation SetShippingAddressForBuyerPrice($input: CreateAddressInput!) {
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
    mutation CreateDraftOrderForBuyerPrice {
        createDraftOrder {
            id
        }
    }
`);

const setCustomerForDraftOrderDocument = adminGraphql(`
    mutation SetCustomerForDraftOrderForBuyerPrice($orderId: ID!, $customerId: ID!) {
        setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId) {
            ... on Order {
                id
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

const addItemToDraftOrderDocument = adminGraphql(`
    mutation AddItemToDraftOrderForBuyerPrice($orderId: ID!, $input: AddItemToDraftOrderInput!) {
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

const setDraftOrderShippingDocument = adminGraphql(`
    mutation SetDraftOrderShippingForBuyerPrice(
        $orderId: ID!
        $input: CreateAddressInput!
        $shippingMethodId: ID!
    ) {
        setDraftOrderShippingAddress(orderId: $orderId, input: $input) {
            id
        }
        setDraftOrderShippingMethod(orderId: $orderId, shippingMethodId: $shippingMethodId) {
            ... on Order {
                id
            }
        }
    }
`);

const getOrderLinesDocument = adminGraphql(`
    query GetOrderLinesForBuyerPrice($id: ID!) {
        order(id: $id) {
            state
            lines {
                id
                quantity
                unitPrice
                productVariant {
                    id
                }
            }
        }
    }
`);

const modifyOrderDocument = adminGraphql(`
    mutation ModifyOrderForBuyerPrice($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            ... on Order {
                lines {
                    quantity
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

type AddItemResult = ResultOf<typeof addItemDocument>['addItemToOrder'];
type OrderResult = Extract<AddItemResult, { lines: unknown }>;
type VariantPrices = NonNullable<ResultOf<typeof getVariantPricesDocument>['product']>['variants'];

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductVariant.buyerPrice with a custom ProductVariantBuyerPriceStrategy', () => {
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
            plugins: [TestBuyerPricePlugin],
            customFields: {
                OrderLine: [
                    { name: 'unitCode', type: 'string' },
                    { name: 'giftAsset', type: 'relation', entity: Asset },
                ],
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
    /** A second Customer with the fixed price, who has no Order before the login test. */
    let loginCustomer: { id: string; emailAddress: string };
    /** A third Customer with the fixed price, who has no Order before the login test without a price. */
    let secondLoginCustomer: { id: string; emailAddress: string };
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
            customFields: customFields && customFieldsInput(customFields),
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
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 3 } });
        [fixedPriceCustomer, loginCustomer, secondLoginCustomer] = customers.items;
        fixedPriceEmailAddresses.add(fixedPriceCustomer.emailAddress);
        fixedPriceEmailAddresses.add(loginCustomer.emailAddress);
        fixedPriceEmailAddresses.add(secondLoginCustomer.emailAddress);
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

        expect(variant.buyerPrice!.price).toBe(FIXED_UNIT_PRICE);
        expect(variant.buyerPrice!.price).not.toBe(variant.price);
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
        const { product } = await shopClient.query(getTwiceBuyerPriceDocument, { id: 'T_1' });
        await shopClient.asUserWithCredentials(fixedPriceCustomer.emailAddress, 'test');

        product!.variants.forEach((variant, i) => {
            expect(variant.first!.price).toBe(Math.round(channelPrices[i].price * 0.8));
            expect(variant.second!.price).toBe(variant.first!.price);
        });
    });

    it('equals the unit price of the cart line for the same customer and quantity', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        const variant = product!.variants[0];

        const line = await addToCart(shopClient, variant.id, 1);

        expect(line.unitPrice).toBe(variant.buyerPrice!.price);
        expect(line.unitPriceWithTax).toBe(variant.buyerPrice!.priceWithTax);
    });

    it('equals the unit price of the cart line for quantity 10', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 10 });
        const variant = product!.variants[1];

        expect(variant.buyerPrice!.price).toBe(Math.round(FIXED_UNIT_PRICE * 0.8));

        const line = await addToCart(shopClient, variant.id, 10);

        expect(line.quantity).toBe(10);
        expect(line.unitPrice).toBe(variant.buyerPrice!.price);
        expect(line.unitPriceWithTax).toBe(variant.buyerPrice!.priceWithTax);
    });

    it('equals the unit price of the cart line for the same OrderLine custom fields', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, {
            id: 'T_1',
            quantity: 2,
            customFields: customFieldsInput({ unitCode: 'BOX' }),
        });
        const variant = product!.variants[2];

        expect(variant.buyerPrice!.price).toBe(FIXED_UNIT_PRICE * BOX_SIZE);

        const line = await addToCart(shopClient, variant.id, 2, { unitCode: 'BOX' });

        expect(line.unitPrice).toBe(variant.buyerPrice!.price);
        expect(line.unitPriceWithTax).toBe(variant.buyerPrice!.priceWithTax);
    });

    it('decodes the ID values in the custom fields', async () => {
        buyerPriceData.length = 0;
        await shopClient.query(getVariantPricesDocument, {
            id: 'T_1',
            customFields: customFieldsInput({ giftAssetId: 'T_1' }),
        });

        expect(buyerPriceData.length).toBeGreaterThan(0);
        expect(buyerPriceData.map(data => data?.giftAssetId)).toEqual(buyerPriceData.map(() => 1));
    });

    it('gives null when the strategy has no price for the buyer', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, {
            id: 'T_1',
            customFields: customFieldsInput({ unitCode: 'NONE' }),
        });

        expect(product!.variants[0].buyerPrice).toBeNull();
        expect(product!.variants[0].price).toBe(channelPrices[0].price);
    });

    it('does not add an item to the cart when the strategy has no price for the buyer', async () => {
        const { activeOrder: before } = await shopClient.query(getActiveOrderLinesDocument);

        await expect(addToCart(shopClient, channelPrices[0].id, 1, { unitCode: 'NONE' })).rejects.toThrow(
            'has no price for this buyer',
        );

        const { activeOrder: after } = await shopClient.query(getActiveOrderLinesDocument);
        expect(after!.lines).toEqual(before!.lines);
    });

    it('passes the metadata of the result to the BuyerPrice resolvers and to the order item layers', async () => {
        const { product } = await shopClient.query<{
            product: { variants: Array<{ id: string; buyerPrice: { appliedRule: string | null } | null }> };
        }>(
            gql`
                query GetBuyerPriceRule($id: ID!) {
                    product(id: $id) {
                        variants {
                            id
                            buyerPrice(quantity: 10) {
                                appliedRule
                            }
                        }
                    }
                }
            `,
            { id: 'T_1' },
        );
        expect(product.variants[0].buyerPrice).toEqual({ appliedRule: 'TIER_10' });

        orderItemMetadata.length = 0;
        await addToCart(shopClient, product.variants[3].id, 1);
        expect(orderItemMetadata).toEqual([{ rule: 'FIXED' }]);
    });

    it('returns the channel price for a guest session', async () => {
        await shopClient.asAnonymousUser();
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });

        for (const variant of product!.variants) {
            expect(variant.buyerPrice).toEqual({
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
            input: { emailAddress: GUEST_EMAIL_ADDRESS, firstName: 'Guest', lastName: 'Buyer' },
        });
        const secondLine = await addToCart(shopClient, channelPrices[1].id, 1);

        expect(secondLine.unitPrice).toBe(FIXED_UNIT_PRICE);
        // The line that was added before the Customer was set gets the price of the Customer too
        const { activeOrder } = await shopClient.query(getActiveOrderLinesDocument);
        expect(activeOrder!.lines.map(l => l.unitPrice)).toEqual([FIXED_UNIT_PRICE, FIXED_UNIT_PRICE]);
        // The session has no Customer, so the buyer price is the channel price
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1' });
        expect(product!.variants[1].buyerPrice!.price).toBe(channelPrices[1].price);
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

    it('calculates the cart again when a login gives the guest order to a customer', async () => {
        await shopClient.asAnonymousUser();
        const line = await addToCart(shopClient, channelPrices[0].id, 1);
        expect(line.unitPrice).toBe(channelPrices[0].price);

        // Logs in with the session of the guest order. asUserWithCredentials() would log out first.
        await shopClient.query(attemptLoginDocument, {
            username: loginCustomer.emailAddress,
            password: 'test',
        });

        const { activeOrder } = await shopClient.query(getActiveOrderLinesDocument);
        expect(activeOrder!.lines.map(l => l.unitPrice)).toEqual([FIXED_UNIT_PRICE]);
    });

    it('calculates a draft order again when the customer is set after the items', async () => {
        const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
        const { addItemToDraftOrder } = await adminClient.query(addItemToDraftOrderDocument, {
            orderId: createDraftOrder.id,
            input: { productVariantId: channelPrices[0].id, quantity: 1 },
        });
        expect(addItemToDraftOrder).toEqual({ lines: [{ unitPrice: channelPrices[0].price }] });

        const { setCustomerForDraftOrder } = await adminClient.query(setCustomerForDraftOrderDocument, {
            orderId: createDraftOrder.id,
            customerId: fixedPriceCustomer.id,
        });

        expect(setCustomerForDraftOrder).toEqual({
            id: createDraftOrder.id,
            lines: [{ unitPrice: FIXED_UNIT_PRICE }],
        });
    });

    describe('a line that has a price, and then has no price', () => {
        let lineId: string;

        async function getLinePrices() {
            const { activeOrder } = await shopClient.query(getActiveOrderLinesDocument);
            return activeOrder!.lines.map(l => [l.productVariant.id, l.quantity, l.unitPrice]);
        }

        beforeAll(async () => {
            await shopClient.asAnonymousUser();
            await addToCart(shopClient, channelPrices[0].id, 1);
            lineId = (await addToCart(shopClient, channelPrices[3].id, 1)).id;
            noPriceSkus.add(channelPrices[3].sku);
        });

        afterAll(() => {
            noPriceSkus.clear();
        });

        it('keeps its price when the shipping address is set', async () => {
            const { setOrderShippingAddress } = await shopClient.query(setShippingAddressDocument, {
                input: { streetLine1: '1 Test Street', countryCode: 'GB' },
            });

            expect(setOrderShippingAddress).toEqual({ id: expect.any(String) });
            expect(await getLinePrices()).toEqual([
                [channelPrices[0].id, 1, channelPrices[0].price],
                [channelPrices[3].id, 1, channelPrices[3].price],
            ]);
        });

        it('keeps its price when its quantity changes', async () => {
            const { adjustOrderLine } = await shopClient.query(adjustOrderLineDocument, {
                orderLineId: lineId,
                quantity: 2,
            });

            orderGuard.assertSuccess(adjustOrderLine);
            expect(await getLinePrices()).toEqual([
                [channelPrices[0].id, 1, channelPrices[0].price],
                [channelPrices[3].id, 2, channelPrices[3].price],
            ]);
        });

        it('keeps its price when the customer of the order changes, and the other lines get the new price', async () => {
            const { setCustomerForOrder } = await shopClient.query(setCustomerForOrderDocument, {
                input: { emailAddress: GUEST_EMAIL_ADDRESS, firstName: 'Guest', lastName: 'Buyer' },
            });

            expect(setCustomerForOrder).toEqual({ id: expect.any(String) });
            expect(await getLinePrices()).toEqual([
                [channelPrices[0].id, 1, FIXED_UNIT_PRICE],
                [channelPrices[3].id, 2, channelPrices[3].price],
            ]);
        });

        it('is not added as a new line', async () => {
            const before = await getLinePrices();

            // Other custom fields, so that the item does not go into the existing line
            await expect(addToCart(shopClient, channelPrices[3].id, 1, { unitCode: 'BOX' })).rejects.toThrow(
                'has no price for this buyer',
            );

            expect(await getLinePrices()).toEqual(before);
        });

        it('is not kept after a currency change, so the currency change fails', async () => {
            const before = await getLinePrices();
            await adminClient.query(updateChannelDocument, {
                input: { id: 'T_1', availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.GBP] },
            });
            try {
                // The current price is in the old currency
                await expect(
                    shopClient.query(setCurrencyCodeForOrderDocument, { currencyCode: CurrencyCode.GBP }),
                ).rejects.toThrow('has no price for this buyer');
            } finally {
                await adminClient.query(updateChannelDocument, {
                    input: { id: 'T_1', availableCurrencyCodes: [CurrencyCode.USD] },
                });
            }

            expect(await getLinePrices()).toEqual(before);
        });
    });

    describe('a line that has no price for the new customer of the order', () => {
        beforeAll(() => {
            noPriceSkusForFixedPriceCustomers.add(channelPrices[3].sku);
        });

        afterAll(() => {
            noPriceSkusForFixedPriceCustomers.clear();
        });

        it('keeps its price when a login gives the guest order to the customer', async () => {
            await shopClient.asAnonymousUser();
            await addToCart(shopClient, channelPrices[0].id, 1);
            await addToCart(shopClient, channelPrices[3].id, 1);

            const { login } = await shopClient.query(attemptLoginDocument, {
                username: secondLoginCustomer.emailAddress,
                password: 'test',
            });
            expect(login).toEqual(expect.objectContaining({ identifier: secondLoginCustomer.emailAddress }));

            const { activeOrder } = await shopClient.query(getActiveOrderLinesDocument);
            expect(activeOrder!.lines.map(l => [l.productVariant.id, l.unitPrice])).toEqual([
                [channelPrices[0].id, FIXED_UNIT_PRICE],
                [channelPrices[3].id, channelPrices[3].price],
            ]);
        });

        it('keeps its price in a draft order after setCustomerForDraftOrder', async () => {
            const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
            for (const variant of [channelPrices[0], channelPrices[3]]) {
                await adminClient.query(addItemToDraftOrderDocument, {
                    orderId: createDraftOrder.id,
                    input: { productVariantId: variant.id, quantity: 1 },
                });
            }

            const { setCustomerForDraftOrder } = await adminClient.query(setCustomerForDraftOrderDocument, {
                orderId: createDraftOrder.id,
                customerId: fixedPriceCustomer.id,
            });

            expect(setCustomerForDraftOrder).toEqual({
                id: createDraftOrder.id,
                lines: [{ unitPrice: FIXED_UNIT_PRICE }, { unitPrice: channelPrices[3].price }],
            });
        });

        it('is not merged when a login merges the guest order into the order of the customer', async () => {
            // The login customer has an active order from an earlier test. The guest line without
            // a price is a new line in that order, so it is not added. The other guest line is merged.
            const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_2' });
            const [withPrice, withoutPrice] = product!.variants;
            noPriceSkusForFixedPriceCustomers.add(withoutPrice.sku);
            await shopClient.asAnonymousUser();
            await addToCart(shopClient, withPrice.id, 1);
            await addToCart(shopClient, withoutPrice.id, 1);

            const { login } = await shopClient.query(attemptLoginDocument, {
                username: loginCustomer.emailAddress,
                password: 'test',
            });
            expect(login).toEqual(expect.objectContaining({ identifier: loginCustomer.emailAddress }));

            const { activeOrder } = await shopClient.query(getActiveOrderLinesDocument);
            expect(activeOrder!.lines.map(l => [l.productVariant.id, l.unitPrice])).toEqual([
                [channelPrices[0].id, FIXED_UNIT_PRICE],
                [withPrice.id, FIXED_UNIT_PRICE],
            ]);
        });
    });

    it('prices an order line for the buyer that an order item layer passes to the inner chain', async () => {
        await shopClient.asAnonymousUser();
        // The layer runs on the server, where the ID has no "T_" prefix
        buyerOverride.customerId = Number(fixedPriceCustomer.id.replace('T_', ''));
        orderItemBuyerCustomerIds.length = 0;
        try {
            const line = await addToCart(shopClient, channelPrices[0].id, 1);

            expect(line.unitPrice).toBe(FIXED_UNIT_PRICE);
            // The inner layer got the buyer of the outer layer
            expect(orderItemBuyerCustomerIds).toEqual([buyerOverride.customerId]);
        } finally {
            buyerOverride.customerId = undefined;
        }
    });

    it('exports the default OrderItemPriceCalculationStrategy from @vendure/core', () => {
        const { orderItemPriceCalculationStrategy } = server.app.get(ConfigService).orderOptions;

        expect(getBaseStrategy(orderItemPriceCalculationStrategy)).toBeInstanceOf(
            DefaultOrderItemPriceCalculationStrategy,
        );
    });

    describe('modifyOrder', () => {
        let orderId: string;
        let lineWithoutPriceId: string;

        beforeAll(async () => {
            // A placed order in the Modifying state, made from a draft order with a manual payment
            const { createDraftOrder } = await adminClient.query(createDraftOrderDocument);
            orderId = createDraftOrder.id;
            await adminClient.query(setCustomerForDraftOrderDocument, {
                orderId,
                customerId: fixedPriceCustomer.id,
            });
            for (const variant of [channelPrices[0], channelPrices[1]]) {
                await adminClient.query(addItemToDraftOrderDocument, {
                    orderId,
                    input: { productVariantId: variant.id, quantity: 1 },
                });
            }
            await adminClient.query(setDraftOrderShippingDocument, {
                orderId,
                input: { streetLine1: '1 Test Street', countryCode: 'GB' },
                shippingMethodId: 'T_1',
            });
            await adminClient.query(adminTransitionToStateDocument, {
                id: orderId,
                state: 'ArrangingPayment',
            });
            await adminClient.query(addManualPaymentDocument, {
                input: { orderId, method: 'manual', metadata: {}, transactionId: 'buyer-price' },
            });
            await adminClient.query(adminTransitionToStateDocument, { id: orderId, state: 'Modifying' });
            const { order } = await adminClient.query(getOrderLinesDocument, { id: orderId });
            expect(order!.state).toBe('Modifying');
            lineWithoutPriceId = order!.lines.find(l => l.productVariant.id === channelPrices[1].id)!.id;
            noPriceSkus.add(channelPrices[1].sku);
        });

        afterAll(() => {
            noPriceSkus.clear();
        });

        it('keeps the price of a line that is already in the order', async () => {
            const { modifyOrder } = await adminClient.query(modifyOrderDocument, {
                input: {
                    orderId,
                    dryRun: true,
                    adjustOrderLines: [{ orderLineId: lineWithoutPriceId, quantity: 2 }],
                },
            });

            expect(modifyOrder).toEqual({
                lines: [
                    { quantity: 1, unitPrice: FIXED_UNIT_PRICE, productVariant: { id: channelPrices[0].id } },
                    { quantity: 2, unitPrice: FIXED_UNIT_PRICE, productVariant: { id: channelPrices[1].id } },
                ],
            });
        });

        it('rejects a new line that has no price', async () => {
            noPriceSkus.add(channelPrices[2].sku);

            await expect(
                adminClient.query(modifyOrderDocument, {
                    input: {
                        orderId,
                        dryRun: true,
                        addItems: [{ productVariantId: channelPrices[2].id, quantity: 1 }],
                    },
                }),
            ).rejects.toThrow('has no price for this buyer');
        });

        it('fails for a line that has no price after a currency change', async () => {
            await adminClient.query(updateChannelDocument, {
                input: { id: 'T_1', availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.GBP] },
            });
            try {
                // The current price of the line is in the currency of the order
                await expect(
                    adminClient.query(
                        modifyOrderDocument,
                        {
                            input: {
                                orderId,
                                dryRun: true,
                                adjustOrderLines: [{ orderLineId: lineWithoutPriceId, quantity: 2 }],
                            },
                        },
                        { currencyCode: CurrencyCode.GBP },
                    ),
                ).rejects.toThrow('has no price for this buyer');
            } finally {
                await adminClient.query(updateChannelDocument, {
                    input: { id: 'T_1', availableCurrencyCodes: [CurrencyCode.USD] },
                });
            }
        });
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
            'The quantity for the buyer price must be a positive integer',
        ),
    );

    it(
        'rejects a negative quantity',
        assertThrowsWithMessage(
            () => shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: -1 }),
            'The quantity for the buyer price must be a positive integer',
        ),
    );
});
