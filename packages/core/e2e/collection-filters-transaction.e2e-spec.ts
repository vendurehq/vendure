/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { OnApplicationBootstrap } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    CollectionEvent,
    EventBus,
    facetValueCollectionFilter,
    mergeConfig,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createCollectionDocument, getFacetListDocument } from './graphql/shared-definitions';
import { getCollectionVariantsDocument } from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

/**
 * Holds the `createCollection` transaction open for `delayMs` after the apply-collection-filters
 * job has been triggered, by blocking on the CollectionEvent which `CollectionService.create()`
 * publishes inside the transaction.
 *
 * A loaded server does this by accident. The delay makes it deterministic.
 */
@VendurePlugin({ imports: [PluginCommonModule] })
class DelayCommitPlugin implements OnApplicationBootstrap {
    static delayMs = 0;

    constructor(private eventBus: EventBus) {}

    onApplicationBootstrap() {
        this.eventBus.registerBlockingEventHandler({
            event: CollectionEvent,
            id: 'delay-collection-commit',
            handler: async () => {
                if (DelayCommitPlugin.delayMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, DelayCommitPlugin.delayMs));
                }
            },
        });
    }
}

/**
 * The job which applies collection filters runs on its own connection, so it cannot see rows
 * written by a transaction which has not committed. These tests hold the `createCollection`
 * transaction open past the point at which the job handler gives up looking for the collection,
 * and check that the filters are applied to it regardless.
 */
describe('Collection filters and transactions', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { plugins: [DelayCommitPlugin] }),
    );

    let sportsEquipmentId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const { facets } = await adminClient.query(getFacetListDocument);
        sportsEquipmentId = facets.items[0].values.find(v => v.code === 'sports-equipment')!.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function createSportsCollection(slug: string) {
        const { createCollection } = await adminClient.query(createCollectionDocument, {
            input: {
                filters: [
                    {
                        code: facetValueCollectionFilter.code,
                        arguments: [
                            { name: 'facetValueIds', value: `["${sportsEquipmentId}"]` },
                            { name: 'containsAny', value: 'false' },
                        ],
                    },
                ],
                translations: [{ languageCode: LanguageCode.en, name: slug, description: '', slug }],
            },
        });
        await awaitRunningJobs(adminClient);
        return createCollection;
    }

    it('applies the filters when the transaction commits promptly', async () => {
        DelayCommitPlugin.delayMs = 0;
        const collection = await createSportsCollection('fast-commit');

        const { collection: result } = await shopClient.query(getCollectionVariantsDocument, {
            id: collection.id,
        });
        expect(result!.productVariants.items.length).toBe(10);
    });

    it('applies the filters when the transaction is slow to commit', async () => {
        // Longer than the job queue poll interval plus the handler's lookup retries, so the job
        // would have given up on finding the collection had it been enqueued before the commit.
        DelayCommitPlugin.delayMs = 600;
        const collection = await createSportsCollection('slow-commit');

        const { collection: result } = await shopClient.query(getCollectionVariantsDocument, {
            id: collection.id,
        });
        expect(result!.productVariants.items.length).toBe(10);
    });
});
