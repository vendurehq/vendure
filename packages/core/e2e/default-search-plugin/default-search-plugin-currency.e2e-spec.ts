import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { DefaultJobQueuePlugin, DefaultSearchPlugin, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../../e2e-common/test-config';
import { reindexDocument } from '../graphql/admin-definitions';
import { graphql } from '../graphql/graphql-shop';
import {
    getProductVariantListDocument,
    updateChannelDocument,
    updateProductVariantsDocument,
} from '../graphql/shared-definitions';
import { awaitRunningJobs } from '../utils/await-running-jobs';

const searchProductsByCurrencyDocument = graphql(`
    query SearchProductsByCurrency($input: SearchInput!) {
        search(input: $input) {
            totalItems
            items {
                productVariantId
                currencyCode
                priceWithTax {
                    ... on SinglePrice {
                        value
                    }
                    ... on PriceRange {
                        min
                        max
                    }
                }
            }
        }
    }
`);

const isNonSqliteDatabase = process.env.DB != null && process.env.DB !== 'sqljs';

describe.skipIf(isNonSqliteDatabase)('Default search plugin currency indexing', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DefaultSearchPlugin.init({ indexCurrencyCode: true }), DefaultJobQueuePlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures', 'default-search-plugin-sort-by.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        await adminClient.query(updateChannelDocument, {
            input: {
                id: 'T_1',
                availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.EUR],
            },
        });
        const { productVariants } = await adminClient.query(getProductVariantListDocument, {
            options: { filter: { sku: { eq: 'BA40' } } },
        });
        await adminClient.query(updateProductVariantsDocument, {
            input: [
                {
                    id: productVariants.items[0].id,
                    prices: [
                        { currencyCode: CurrencyCode.USD, price: 10_000 },
                        { currencyCode: CurrencyCode.EUR, price: 9_300 },
                    ],
                },
            ],
        });
        await awaitRunningJobs(adminClient);
        await adminClient.query(reindexDocument);
        await awaitRunningJobs(adminClient);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
    });

    async function search(currencyCode: CurrencyCode, groupByProduct: boolean) {
        return shopClient.query(
            searchProductsByCurrencyDocument,
            { input: { term: 'Boot A', groupByProduct } },
            { currencyCode },
        );
    }

    it.each([
        [CurrencyCode.USD, 12_000],
        [CurrencyCode.EUR, 11_160],
    ])('returns only the %s indexed row for an ungrouped search', async (currencyCode, value) => {
        const { search: result } = await search(currencyCode, false);

        expect(result.totalItems).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            currencyCode,
            priceWithTax: { value },
        });
    });

    it.each([
        [CurrencyCode.USD, 12_000],
        [CurrencyCode.EUR, 11_160],
    ])('does not combine currencies in a grouped %s search', async (currencyCode, value) => {
        const { search: result } = await search(currencyCode, true);

        expect(result.totalItems).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]).toMatchObject({
            currencyCode,
            priceWithTax: { min: value, max: value },
        });
    });
});
