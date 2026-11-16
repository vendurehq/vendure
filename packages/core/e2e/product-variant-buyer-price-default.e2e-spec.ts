import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { Logger as TypeOrmLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-shop';
import {
    assignProductToChannelDocument,
    createChannelDocument,
    deleteProductVariantDocument,
    getCustomerListDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument } from './graphql/shop-definitions';

const buyerPriceDocument = graphql(`
    query GetBuyerPriceDefault($productVariantId: ID!, $quantity: Int) {
        buyerPrice(productVariantId: $productVariantId, quantity: $quantity) {
            productVariantId
            price
            priceWithTax
        }
    }
`);

const buyerPricesDocument = graphql(`
    query GetBuyerPricesDefault($input: [BuyerPriceInput!]!) {
        buyerPrices(input: $input) {
            productVariantId
            price
            priceWithTax
        }
    }
`);

const getVariantChannelPricesDocument = graphql(`
    query GetVariantChannelPricesDefault($id: ID!) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
            }
        }
    }
`);

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('The buyerPrice and buyerPrices queries with the default ProductVariantBuyerPriceStrategy', () => {
    const SECOND_CHANNEL_TOKEN = 'buyer-price-second-channel';
    /** The number of SQL queries run since it was last reset to 0. */
    let sqlQueryCount = 0;
    /** The number of SQL queries that select from the product_variant table, since it was last reset to 0. */
    let variantQueryCount = 0;
    const countingLogger: TypeOrmLogger = {
        logQuery: query => {
            sqlQueryCount++;
            if (/from ["`]product_variant["`]/i.test(query)) {
                variantQueryCount++;
            }
        },
        logQueryError: () => undefined,
        logQuerySlow: () => undefined,
        logSchemaBuild: () => undefined,
        logMigration: () => undefined,
        log: () => undefined,
    };
    let customerEmailAddress: string;
    const config = testConfig();
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...config,
        dbConnectionOptions: {
            ...config.dbConnectionOptions,
            logging: ['query'],
            logger: countingLogger,
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 1 } });
        customerEmailAddress = customers.items[0].emailAddress;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('equals price and priceWithTax', async () => {
        const { product } = await shopClient.query(getVariantChannelPricesDocument, { id: 'T_1' });
        const variants = product!.variants;
        const expected = variants.map(v => ({
            productVariantId: v.id,
            price: v.price,
            priceWithTax: v.priceWithTax,
        }));

        const { buyerPrice } = await shopClient.query(buyerPriceDocument, {
            productVariantId: variants[0].id,
            quantity: 5,
        });
        const { buyerPrices } = await shopClient.query(buyerPricesDocument, {
            input: variants.map(v => ({ productVariantId: v.id, quantity: 5 })),
        });

        expect(variants.length).toBeGreaterThan(1);
        expect(buyerPrice).toEqual(expected[0]);
        expect(buyerPrices).toEqual(expected);
    });

    it('is not in the ProductVariant type', async () => {
        await expect(
            shopClient.query(gql`
                query {
                    product(id: "T_1") {
                        variants {
                            buyerPrice {
                                price
                            }
                        }
                    }
                }
            `),
        ).rejects.toThrow('Cannot query field "buyerPrice" on type "ProductVariant"');
    });

    async function countQueries(query: () => Promise<unknown>) {
        // The first request warms up caches which are not part of the query
        await query();
        sqlQueryCount = 0;
        variantQueryCount = 0;
        await query();
        return { all: sqlQueryCount, variant: variantQueryCount };
    }

    // The variant is loaded with its relations, and the check that the variant and its Product are
    // available in the Channel loads the assignments of all variants at once
    it('runs the same SQL queries for one input and for the variants of several products, for a guest and for a logged-in customer', async () => {
        // The Product T_1 has the variants T_1 to T_4, and the Product T_2 has the variants T_5 and T_6
        const oneInput = [{ productVariantId: 'T_1' }];
        const sixInputs = ['T_1', 'T_2', 'T_3', 'T_4', 'T_5', 'T_6'].map(id => ({ productVariantId: id }));
        for (const login of [false, true]) {
            if (login) {
                await shopClient.asUserWithCredentials(customerEmailAddress, 'test');
            }
            const single = await countQueries(() =>
                shopClient.query(buyerPriceDocument, { productVariantId: 'T_1' }),
            );
            const withOneInput = await countQueries(() =>
                shopClient.query(buyerPricesDocument, { input: oneInput }),
            );
            const withSixInputs = await countQueries(() =>
                shopClient.query(buyerPricesDocument, { input: sixInputs }),
            );

            expect(withOneInput.variant).toBe(1);
            expect(withSixInputs).toEqual(withOneInput);
            expect(single).toEqual(withOneInput);
        }
        await shopClient.asAnonymousUser();
    });

    it('rejects more inputs than the shopListQueryLimit', async () => {
        const input = Array.from({ length: 101 }, () => ({ productVariantId: 'T_1' }));

        await expect(shopClient.query(buyerPricesDocument, { input })).rejects.toThrow(
            'Cannot take more than 100 results from a list query',
        );
    });

    describe('a variant that has no buyer price', () => {
        async function getBuyerPrices(ids: string[]) {
            const { buyerPrices } = await shopClient.query(buyerPricesDocument, {
                input: ids.map(id => ({ productVariantId: id })),
            });
            const single = await Promise.all(
                ids.map(async id => {
                    const { buyerPrice } = await shopClient.query(buyerPriceDocument, {
                        productVariantId: id,
                    });
                    return buyerPrice;
                }),
            );
            expect(single).toEqual(buyerPrices);
            return buyerPrices;
        }

        it('gives null for an unknown variant, in the order of the input', async () => {
            const prices = await getBuyerPrices(['T_3', 'T_999', 'T_1']);

            expect(prices.map(p => p?.productVariantId ?? null)).toEqual(['T_3', null, 'T_1']);
        });

        it('gives null for a variant of another Channel', async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'buyer-price-second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            if (!('id' in createChannel)) {
                throw new Error(createChannel.message);
            }
            const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: createChannel.id, productIds: ['T_2'] },
            });
            expect(assignProductsToChannel[0].variants.map(v => v.id)).toEqual(['T_5', 'T_6']);
            shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            try {
                const prices = await getBuyerPrices(['T_1', 'T_5']);

                expect(prices.map(p => p?.productVariantId ?? null)).toEqual([null, 'T_5']);
            } finally {
                shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            }
        });

        it('gives null for a deleted variant', async () => {
            await adminClient.query(deleteProductVariantDocument, { id: 'T_4' });

            const prices = await getBuyerPrices(['T_4', 'T_3']);

            expect(prices.map(p => p?.productVariantId ?? null)).toEqual([null, 'T_3']);
        });

        it('gives null when the variant is disabled in the Channel', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: 'T_1', enabledInChannel: false }],
            });

            const prices = await getBuyerPrices(['T_1', 'T_5']);

            expect(prices.map(p => p?.productVariantId ?? null)).toEqual([null, 'T_5']);
        });

        it('gives null when the Product is disabled in the Channel', async () => {
            await adminClient.query(updateProductDocument, { input: { id: 'T_2', enabledInChannel: false } });

            const prices = await getBuyerPrices(['T_5', 'T_3']);

            expect(prices.map(p => p?.productVariantId ?? null)).toEqual([null, 'T_3']);
        });

        it('cannot be added to the Order', async () => {
            await expect(
                shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 }),
            ).rejects.toThrow('No ProductVariant with the id');
        });
    });
});
