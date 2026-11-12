import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { Logger as TypeOrmLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-shop';
import {
    getCustomerListDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument } from './graphql/shop-definitions';

const getVariantPricesDocument = graphql(`
    query GetVariantBuyerPricesDefault($id: ID!, $quantity: Int) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
                buyerPrice(quantity: $quantity) {
                    price
                    priceWithTax
                }
            }
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

const getActiveOrderBuyerPricesDocument = graphql(`
    query GetActiveOrderBuyerPricesDefault {
        activeOrder {
            lines {
                productVariant {
                    id
                    buyerPrice {
                        price
                    }
                }
            }
        }
    }
`);

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductVariant.buyerPrice with the default ProductVariantBuyerPriceStrategy', () => {
    /** The number of SQL queries run since it was last reset to 0. */
    let sqlQueryCount = 0;
    const countingLogger: TypeOrmLogger = {
        logQuery: () => {
            sqlQueryCount++;
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
        const { product } = await shopClient.query(getVariantPricesDocument, {
            id: 'T_1',
            quantity: 5,
        });

        expect(product!.variants.length).toBeGreaterThan(1);
        for (const variant of product!.variants) {
            expect(variant.buyerPrice).toEqual({
                price: variant.price,
                priceWithTax: variant.priceWithTax,
            });
        }
    });

    async function countQueries(query: () => Promise<unknown>) {
        // The first request warms up caches which are not part of the field resolver
        await query();
        sqlQueryCount = 0;
        await query();
        return sqlQueryCount;
    }

    // The check that the variant and its Product are available in the Channel adds a fixed number of
    // queries for each request, not a number for each variant
    it('runs the same number of extra SQL queries for each product, for a guest and for a logged-in customer', async () => {
        for (const login of [false, true]) {
            if (login) {
                await shopClient.asUserWithCredentials(customerEmailAddress, 'test');
            }
            const extraQueries: number[] = [];
            // The Product T_1 has 4 variants, and the Product T_2 has 2 variants
            for (const id of ['T_1', 'T_2']) {
                const withoutField = await countQueries(() =>
                    shopClient.query(getVariantChannelPricesDocument, { id }),
                );
                const withField = await countQueries(() =>
                    shopClient.query(getVariantPricesDocument, { id }),
                );
                expect(withoutField).toBeGreaterThan(0);
                extraQueries.push(withField - withoutField);
            }

            expect(extraQueries[0]).toBeLessThanOrEqual(3);
            expect(extraQueries[1]).toBe(extraQueries[0]);
        }
    });

    describe('a variant that is not available in the Channel', () => {
        async function getLineBuyerPrices() {
            const { activeOrder } = await shopClient.query(getActiveOrderBuyerPricesDocument);
            return Object.fromEntries(
                activeOrder!.lines.map(line => [line.productVariant.id, line.productVariant.buyerPrice]),
            );
        }

        beforeAll(async () => {
            // T_1 is a variant of the Product T_1, and T_5 is a variant of the Product T_2
            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_5', quantity: 1 });
        });

        it('has no buyer price when the variant is disabled in the Channel', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: 'T_1', enabledInChannel: false }],
            });

            const prices = await getLineBuyerPrices();

            expect(prices.T_1).toBeNull();
            expect(prices.T_5).not.toBeNull();
        });

        it('has no buyer price when the Product is disabled in the Channel', async () => {
            await adminClient.query(updateProductDocument, { input: { id: 'T_2', enabledInChannel: false } });

            const prices = await getLineBuyerPrices();

            expect(prices.T_5).toBeNull();
        });

        it('cannot be added to the Order', async () => {
            await expect(
                shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 }),
            ).rejects.toThrow('No ProductVariant with the id');
        });
    });
});
