/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { SortOrder } from '@vendure/common/lib/generated-types';
import { DefaultJobQueuePlugin, DefaultSearchPlugin, mergeConfig, UuidIdStrategy } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { facetValueFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import { getFacetListDocument } from './graphql/shared-definitions';
import { searchProductsShopDocument } from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

describe('Default search plugin with UUIDs', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DefaultSearchPlugin.init({ indexStockStatus: true }), DefaultJobQueuePlugin],
            entityOptions: {
                entityIdStrategy: new UuidIdStrategy(),
            },
        }),
    );

    let plantsFacetValue: FragmentOf<typeof facetValueFragment>;
    let furnitureFacetValue: FragmentOf<typeof facetValueFragment>;
    let photoFacetValue: FragmentOf<typeof facetValueFragment>;
    let electronicsFacetValue: FragmentOf<typeof facetValueFragment>;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-default-search.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // A precaution against a race condition in which the index
        // rebuild is not completed in time for the first test.
        await new Promise(resolve => setTimeout(resolve, 5000));

        // We have extra time here because a lot of jobs are
        // triggered from all the product updates
        await awaitRunningJobs(adminClient, 10_000, 1000);

        const { facets } = await adminClient.query(getFacetListDocument, {
            options: {
                sort: {
                    name: SortOrder.ASC,
                },
            },
        });
        plantsFacetValue = facets.items[0].values.find(v => v.code === 'plants')!;
        furnitureFacetValue = facets.items[0].values.find(v => v.code === 'furniture')!;
        photoFacetValue = facets.items[0].values.find(v => v.code === 'photo')!;
        electronicsFacetValue = facets.items[0].values.find(v => v.code === 'electronics')!;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
    });

    it('can filter by facetValueIds', async () => {
        const result = await shopClient.query(searchProductsShopDocument, {
            input: {
                facetValueIds: [plantsFacetValue.id],
                groupByProduct: true,
                sort: { name: SortOrder.ASC },
            },
        });
        expect(result.search.items.map(i => i.productName)).toEqual([
            'Bonsai Tree',
            'Orchid',
            'Spiky Cactus',
        ]);
    });

    it('can filter by facetValueFilters', async () => {
        await adminClient.query(getFacetListDocument);
        const result = await shopClient.query(searchProductsShopDocument, {
            input: {
                facetValueFilters: [
                    { and: electronicsFacetValue.id },
                    { or: [plantsFacetValue.id, photoFacetValue.id] },
                ],
                sort: { name: SortOrder.ASC },
                groupByProduct: true,
            },
        });
        expect(result.search.items.map(i => i.productName)).toEqual([
            'Camera Lens',
            'Instant Camera',
            'Slr Camera',
            'Tripod',
        ]);
    });
});
