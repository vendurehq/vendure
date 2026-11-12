import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { Logger as TypeOrmLogger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-shop';
import { getCustomerListDocument } from './graphql/shared-definitions';

const getVariantPricesDocument = graphql(`
    query GetVariantShopperPricesDefault(
        $id: ID!
        $quantity: Int
        $customFields: OrderLineCustomFieldsInput
    ) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
                shopperPrice(quantity: $quantity, customFields: $customFields) {
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

describe('ProductVariant.shopperPrice with the default ProductVariantShopperPriceStrategy', () => {
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
        customFields: {
            OrderLine: [{ name: 'unitCode', type: 'string' }],
        },
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
            customFields: { unitCode: 'BOX' },
        });

        expect(product!.variants.length).toBeGreaterThan(1);
        for (const variant of product!.variants) {
            expect(variant.shopperPrice).toEqual({
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

    it('runs no extra SQL query, for a guest and for a logged-in customer', async () => {
        for (const login of [false, true]) {
            if (login) {
                await shopClient.asUserWithCredentials(customerEmailAddress, 'test');
            }
            const withoutField = await countQueries(() =>
                shopClient.query(getVariantChannelPricesDocument, { id: 'T_1' }),
            );
            const withField = await countQueries(() =>
                shopClient.query(getVariantPricesDocument, { id: 'T_1' }),
            );
            const withCustomFields = await countQueries(() =>
                shopClient.query(getVariantPricesDocument, { id: 'T_1', customFields: { unitCode: 'BOX' } }),
            );

            expect(withoutField).toBeGreaterThan(0);
            expect(withField).toBe(withoutField);
            expect(withCustomFields).toBe(withoutField);
        }
    });
});
