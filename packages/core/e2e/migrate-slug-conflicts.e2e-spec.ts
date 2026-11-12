import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ProductTranslation, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { findSlugConflicts, formatSlugConflicts } from '../src/migration-utils/v4_0_slug_conflicts';

import { graphql } from './graphql/graphql-admin';
import { createChannelDocument } from './graphql/shared-definitions';

// OSS-1000 — before v4 the slug check only looked at the active channel and assigning to a
// channel did not check slugs, so existing data can hold per-channel duplicates. There is no
// pre-v4 schema to start from (the schema does not change), so the duplicates are written
// directly to the join tables, the way a v3 assignProductsToChannel would have written them.
describe('findSlugConflicts()', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());
    const B_TOKEN = 'mig-slug-b';
    const C_TOKEN = 'mig-slug-c';
    const channelIds: Record<string, string> = {};

    const createProduct = graphql(`
        mutation MigSlugCreateProduct($input: CreateProductInput!) {
            createProduct(input: $input) {
                id
                slug
            }
        }
    `);
    const createCollection = graphql(`
        mutation MigSlugCreateCollection($input: CreateCollectionInput!) {
            createCollection(input: $input) {
                id
                slug
            }
        }
    `);
    const productBySlug = graphql(`
        query MigSlugProductBySlug($slug: String!) {
            product(slug: $slug) {
                id
            }
        }
    `);
    const assignProducts = graphql(`
        mutation MigSlugAssign($input: AssignProductsToChannelInput!) {
            assignProductsToChannel(input: $input) {
                id
            }
        }
    `);

    const raw = (id: string) => id.replace(/^T_/, '');
    const translations = (slug: string) => [
        { languageCode: LanguageCode.en, name: slug, slug, description: '' },
    ];

    async function setSlug(productId: string, slug: string) {
        const repo = connection().getRepository(ProductTranslation);
        const row = await repo.findOneOrFail({ where: { base: { id: raw(productId) } } });
        row.slug = slug;
        await repo.save(row);
    }

    function connection() {
        return server.app.get(TransactionalConnection).rawConnection;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const [code, token] of [
            ['mig-b', B_TOKEN],
            ['mig-c', C_TOKEN],
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
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('finds nothing in valid data', async () => {
        const queryRunner = connection().createQueryRunner();
        try {
            expect(await findSlugConflicts(queryRunner)).toEqual([]);
        } finally {
            await queryRunner.release();
        }
    });

    it('finds per-channel and default-only conflicts written by pre-v4 code', async () => {
        adminClient.setChannelToken(B_TOKEN);
        const { createProduct: inB } = await adminClient.query(createProduct, {
            input: { translations: translations('dup') },
        });
        await adminClient.query(createCollection, {
            input: { filters: [], translations: translations('col') },
        });
        adminClient.setChannelToken(C_TOKEN);
        const { createProduct: inC } = await adminClient.query(createProduct, {
            input: { translations: translations('dup') },
        });
        const { createCollection: colC } = await adminClient.query(createCollection, {
            input: { filters: [], translations: translations('col') },
        });
        // A product in B may share a slug with a product that lives only in the default channel.
        adminClient.setChannelToken(B_TOKEN);
        await adminClient.query(createProduct, { input: { translations: translations('solo') } });
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { createProduct: defaultOnly } = await adminClient.query(createProduct, {
            input: { translations: translations('solo-tmp') },
        });
        await adminClient.query(createProduct, { input: { translations: translations('solo-default') } });
        const { createProduct: another } = await adminClient.query(createProduct, {
            input: { translations: translations('another') },
        });

        const ds = connection();
        // v3 assignProductsToChannel / assignCollectionsToChannel: no slug check.
        await ds
            .createQueryBuilder()
            .insert()
            .into('product_channels_channel')
            .values({ productId: raw(inC.id), channelId: raw(channelIds['mig-b']) })
            .execute();
        await ds
            .createQueryBuilder()
            .insert()
            .into('collection_channels_channel')
            .values({ collectionId: raw(colC.id), channelId: raw(channelIds['mig-b']) })
            .execute();
        // Two default-only products with the same slug (e.g. a raw import).
        await setSlug('T_1', 'solo-default');
        await setSlug(defaultOnly.id, 'solo');

        const queryRunner = ds.createQueryRunner();
        let conflicts;
        try {
            conflicts = await findSlugConflicts(queryRunner);
        } finally {
            await queryRunner.release();
        }
        const summary = conflicts.map(c => `${c.entity}:${c.channelCode}:${c.slug}:${c.entityIds.length}`);
        expect(summary.sort()).toEqual(
            [
                'Collection:mig-b:col:2',
                `Product:${DEFAULT_CHANNEL_CODE}:solo-default:2`,
                'Product:mig-b:dup:2',
            ].sort(),
        );
        expect(formatSlugConflicts(conflicts)).toContain('3 slug conflict(s) found');

        // "solo" (B product and default-only product) is not reported. The duplicates still
        // resolve deterministically: the oldest product wins in B.
        adminClient.setChannelToken(B_TOKEN);
        expect((await adminClient.query(productBySlug, { slug: 'dup' })).product?.id).toBe(inB.id);
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        expect((await adminClient.query(productBySlug, { slug: 'solo-default' })).product?.id).toBe('T_1');

        expect((await adminClient.query(productBySlug, { slug: 'solo' })).product?.id).toBe(defaultOnly.id);

        // v4 refuses to add another duplicate to B.
        await setSlug(another.id, 'dup');
        await expect(
            adminClient.query(assignProducts, {
                input: { channelId: channelIds['mig-b'], productIds: [another.id] },
            }),
        ).rejects.toThrow(/dup/);
    });
});
