import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { DefaultJobQueuePlugin, DefaultSearchPlugin, mergeConfig } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { graphql as shopGraphql } from './graphql/graphql-shop';
import { createChannelDocument } from './graphql/shared-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

// OSS-1000 — with per-channel slugs, two channels can each have a collection called "sale".
// The search index must only record the collections of the channel each index row belongs to,
// or a collectionSlug search in one channel matches the other channel's collection.
describe('Search by collectionSlug with per-channel collection slugs', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { plugins: [DefaultSearchPlugin, DefaultJobQueuePlugin] }),
    );
    const B_TOKEN = 'search-slug-b';
    const C_TOKEN = 'search-slug-c';
    const channelIds: Record<string, string> = {};

    const assignProducts = graphql(`
        mutation SearchSlugAssign($input: AssignProductsToChannelInput!) {
            assignProductsToChannel(input: $input) {
                id
            }
        }
    `);
    const createCollection = graphql(`
        mutation SearchSlugCreateCollection($input: CreateCollectionInput!) {
            createCollection(input: $input) {
                id
                slug
            }
        }
    `);
    const assignCollections = graphql(`
        mutation SearchSlugAssignCollections($input: AssignCollectionsToChannelInput!) {
            assignCollectionsToChannel(input: $input) {
                id
            }
        }
    `);
    const search = shopGraphql(`
        query SearchSlugSearch($input: SearchInput!) {
            search(input: $input) {
                items {
                    productId
                }
            }
        }
    `);

    async function filteredCollection(token: string, productId: string, slug = 'sale') {
        adminClient.setChannelToken(token);
        const { createCollection: c } = await adminClient.query(createCollection, {
            input: {
                filters: [
                    {
                        code: 'product-id-filter',
                        arguments: [
                            { name: 'productIds', value: JSON.stringify([productId]) },
                            { name: 'combineWithAnd', value: 'true' },
                        ],
                    },
                ],
                translations: [{ languageCode: LanguageCode.en, name: slug, slug, description: '' }],
            },
        });
        return c;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const [code, token] of [
            ['search-b', B_TOKEN],
            ['search-c', C_TOKEN],
        ]) {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelIds[code] = (createChannel as any).id;
        }
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        for (const channelId of Object.values(channelIds)) {
            await adminClient.query(assignProducts, {
                input: { channelId, productIds: ['T_1', 'T_2'] },
            });
        }
        await awaitRunningJobs(adminClient, 60_000, 1000);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
    });

    it('only matches the collection of the active channel', async () => {
        const inC = await filteredCollection(C_TOKEN, 'T_1');
        const inB = await filteredCollection(B_TOKEN, 'T_2');
        expect(inC.slug).toBe('sale');
        expect(inB.slug).toBe('sale');
        await awaitRunningJobs(adminClient, 60_000, 1000);

        shopClient.setChannelToken(B_TOKEN);
        const { search: inBResult } = await shopClient.query(search, {
            input: { collectionSlug: 'sale', groupByProduct: true },
        });
        expect(inBResult.items.map(i => i.productId)).toEqual(['T_2']);

        shopClient.setChannelToken(C_TOKEN);
        const { search: inCResult } = await shopClient.query(search, {
            input: { collectionSlug: 'sale', groupByProduct: true },
        });
        expect(inCResult.items.map(i => i.productId)).toEqual(['T_1']);
    });

    it('assigning a collection to a channel makes it searchable there', async () => {
        const clearance = await filteredCollection(E2E_DEFAULT_CHANNEL_TOKEN, 'T_1', 'clearance');
        await awaitRunningJobs(adminClient, 60_000, 1000);
        shopClient.setChannelToken(B_TOKEN);
        const searchB = () =>
            shopClient.query(search, { input: { collectionSlug: 'clearance', groupByProduct: true } });
        expect((await searchB()).search.items).toEqual([]);

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(assignCollections, {
            input: { channelId: channelIds['search-b'], collectionIds: [clearance.id] },
        });
        await awaitRunningJobs(adminClient, 60_000, 1000);
        shopClient.setChannelToken(B_TOKEN);
        expect((await searchB()).search.items.map(i => i.productId)).toEqual(['T_1']);
    });
});
