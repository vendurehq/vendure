import { CurrencyCode, LanguageCode, SortOrder } from '@vendure/common/lib/generated-types';
import {
    ActiveChannelProductVariantPriceLoadingStrategy,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { reindexDocument } from './graphql/admin-definitions';
import { graphql as graphqlAdmin, ResultOf } from './graphql/graphql-admin';
import { graphql as graphqlShop } from './graphql/graphql-shop';
import {
    assignProductToChannelDocument,
    createChannelDocument,
    getProductWithVariantsDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument, searchProductsShopDocument } from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

const getVariantPricesShopDocument = graphqlShop(`
    query GetVariantPricesShop($id: ID!) {
        product(id: $id) {
            id
            variants {
                id
                sku
                price
                priceWithTax
                currencyCode
            }
        }
    }
`);

const getVariantsSortedByPriceDocument = graphqlAdmin(`
    query GetVariantsSortedByPrice($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            totalItems
            items {
                id
                sku
                price
            }
        }
    }
`);

/**
 * With the ActiveChannelProductVariantPriceLoadingStrategy, `ProductVariant.productVariantPrices`
 * is not eager: the rows of the active Channel are loaded when a variant is priced. Every path
 * that prices a variant must still show each Channel its own price.
 */
describe('ActiveChannelProductVariantPriceLoadingStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            catalogOptions: {
                productVariantPriceLoadingStrategy: new ActiveChannelProductVariantPriceLoadingStrategy(),
            },
            plugins: [DefaultSearchPlugin.init({ indexStockStatus: false }), DefaultJobQueuePlugin],
        }),
    );

    const SECOND_CHANNEL_TOKEN = 'second_channel_token';
    const PRICE_FACTOR = 2;
    let product: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;

    const productGuard: ErrorResultGuard<{ id: string }> = createErrorResultGuard(input => !!input.id);
    const orderGuard: ErrorResultGuard<{ lines: unknown[] }> = createErrorResultGuard(input => !!input.lines);

    function expectedSecondChannelPrice(price: number) {
        return Math.round(price * PRICE_FACTOR);
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await awaitRunningJobs(adminClient, 10_000, 1000);

        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'second-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: false,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        productGuard.assertSuccess(createChannel);

        const { product: defaultChannelProduct } = await adminClient.query(getProductWithVariantsDocument, {
            id: 'T_1',
        });
        productGuard.assertSuccess(defaultChannelProduct);
        product = defaultChannelProduct;

        await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: createChannel.id,
                productIds: [product.id],
                priceFactor: PRICE_FACTOR,
            },
        });
        await awaitRunningJobs(adminClient, 10_000, 1000);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
    });

    it('Admin API shows each Channel its own prices, with one price row per Channel', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { product: secondChannelProduct } = await adminClient.query(getProductWithVariantsDocument, {
            id: product.id,
        });
        productGuard.assertSuccess(secondChannelProduct);

        expect(secondChannelProduct.variants.map(v => v.price)).toEqual(
            product.variants.map(v => expectedSecondChannelPrice(v.price)),
        );
        expect(secondChannelProduct.variants.map(v => v.prices.length)).toEqual(
            product.variants.map(() => 1),
        );
        expect(secondChannelProduct.variants.map(v => v.prices[0].price)).toEqual(
            product.variants.map(v => expectedSecondChannelPrice(v.price)),
        );

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product: defaultChannelProduct } = await adminClient.query(getProductWithVariantsDocument, {
            id: product.id,
        });
        productGuard.assertSuccess(defaultChannelProduct);
        expect(defaultChannelProduct.variants.map(v => v.price)).toEqual(product.variants.map(v => v.price));
        expect(defaultChannelProduct.variants.map(v => v.prices.length)).toEqual(
            product.variants.map(() => 1),
        );
    });

    it('Shop API shows each Channel its own prices on the product', async () => {
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product: defaultChannelProduct } = await shopClient.query(getVariantPricesShopDocument, {
            id: product.id,
        });
        expect(defaultChannelProduct?.variants.map(v => v.price)).toEqual(product.variants.map(v => v.price));
        expect(defaultChannelProduct?.variants.map(v => v.priceWithTax)).toEqual(
            product.variants.map(v => v.priceWithTax),
        );

        shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { product: secondChannelProduct } = await shopClient.query(getVariantPricesShopDocument, {
            id: product.id,
        });
        expect(secondChannelProduct?.variants.map(v => v.price)).toEqual(
            product.variants.map(v => expectedSecondChannelPrice(v.price)),
        );
        expect(secondChannelProduct?.variants.map(v => v.priceWithTax)).toEqual(
            product.variants.map(v => expectedSecondChannelPrice(v.priceWithTax)),
        );
    });

    it('an order line is priced in the Channel of its order', async () => {
        const variant = product.variants[0];

        shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        await shopClient.asAnonymousUser();
        const { addItemToOrder: secondChannelOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: variant.id,
            quantity: 1,
        });
        orderGuard.assertSuccess(secondChannelOrder);
        expect(secondChannelOrder.lines[0].unitPrice).toBe(expectedSecondChannelPrice(variant.price));
        expect(secondChannelOrder.lines[0].unitPriceWithTax).toBe(
            expectedSecondChannelPrice(variant.priceWithTax),
        );

        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await shopClient.asAnonymousUser();
        const { addItemToOrder: defaultChannelOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: variant.id,
            quantity: 1,
        });
        orderGuard.assertSuccess(defaultChannelOrder);
        expect(defaultChannelOrder.lines[0].unitPrice).toBe(variant.price);
        expect(defaultChannelOrder.lines[0].unitPriceWithTax).toBe(variant.priceWithTax);
    });

    it('a variant list sorted by price works without the eager relation', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { productVariants } = await adminClient.query(getVariantsSortedByPriceDocument, {
            options: { sort: { price: SortOrder.ASC }, take: 10 },
        });
        expect(productVariants.totalItems).toBe(product.variants.length);
        const prices = productVariants.items.map(item => item.price);
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
        expect(prices).toEqual(
            product.variants.map(v => expectedSecondChannelPrice(v.price)).sort((a, b) => a - b),
        );
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('the search index holds each Channel its own price', async () => {
        for (const token of [E2E_DEFAULT_CHANNEL_TOKEN, SECOND_CHANNEL_TOKEN]) {
            adminClient.setChannelToken(token);
            await adminClient.query(reindexDocument, {});
            await awaitRunningJobs(adminClient, 10_000, 1000);
        }
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        const indexedPricesBySku = async (token: string) => {
            shopClient.setChannelToken(token);
            const { search } = await shopClient.query(searchProductsShopDocument, {
                input: { groupByProduct: false, take: 100 },
            });
            return new Map(
                search.items
                    .filter(item => item.productId === product.id)
                    .map(item => [item.sku, 'value' in item.price ? item.price.value : undefined]),
            );
        };

        const defaultChannelPrices = await indexedPricesBySku(E2E_DEFAULT_CHANNEL_TOKEN);
        const secondChannelPrices = await indexedPricesBySku(SECOND_CHANNEL_TOKEN);
        for (const variant of product.variants) {
            expect(defaultChannelPrices.get(variant.sku)).toBe(variant.price);
            expect(secondChannelPrices.get(variant.sku)).toBe(expectedSecondChannelPrice(variant.price));
        }
    });
});
