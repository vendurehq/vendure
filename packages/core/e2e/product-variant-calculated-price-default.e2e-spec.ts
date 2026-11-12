import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { Logger as TypeOrmLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-shop';

const getVariantPricesDocument = graphql(`
    query GetVariantPricesDefault($id: ID!, $quantity: Int) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
                calculatedPrice(quantity: $quantity) {
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

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('ProductVariant.calculatedPrice with the default OrderItemPriceCalculationStrategy', () => {
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
    const config = testConfig();
    const { server, shopClient } = createTestEnvironment({
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('equals price and priceWithTax', async () => {
        const { product } = await shopClient.query(getVariantPricesDocument, { id: 'T_1', quantity: 5 });

        expect(product!.variants.length).toBeGreaterThan(1);
        for (const variant of product!.variants) {
            expect(variant.calculatedPrice).toEqual({
                price: variant.price,
                priceWithTax: variant.priceWithTax,
            });
        }
    });

    it('runs no extra SQL query', async () => {
        const countQueries = async (query: () => Promise<unknown>) => {
            // The first request warms up caches which are not part of the field resolver
            await query();
            sqlQueryCount = 0;
            await query();
            return sqlQueryCount;
        };

        const withoutField = await countQueries(() =>
            shopClient.query(getVariantChannelPricesDocument, { id: 'T_1' }),
        );
        const withField = await countQueries(() => shopClient.query(getVariantPricesDocument, { id: 'T_1' }));

        expect(withoutField).toBeGreaterThan(0);
        expect(withField).toBe(withoutField);
    });
});
