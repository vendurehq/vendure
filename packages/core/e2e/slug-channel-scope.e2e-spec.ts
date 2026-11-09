import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { graphql as shopGraphql } from './graphql/graphql-shop';
import { createChannelDocument } from './graphql/shared-definitions';

// OSS-1000 / #2843 — slugs are unique per channel, not globally.
describe('Slug uniqueness is scoped per channel', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    const B_TOKEN = 'slug-b-token';
    const C_TOKEN = 'slug-c-token';
    let bChannelId: string;

    const createProduct = graphql(`
        mutation SlugCreateProduct($input: CreateProductInput!) {
            createProduct(input: $input) {
                id
                slug
            }
        }
    `);
    const updateProduct = graphql(`
        mutation SlugUpdateProduct($input: UpdateProductInput!) {
            updateProduct(input: $input) {
                id
                slug
            }
        }
    `);
    const productBySlug = graphql(`
        query SlugProductBySlug($slug: String!) {
            product(slug: $slug) {
                id
                slug
                name
            }
        }
    `);
    const assignProducts = graphql(`
        mutation SlugAssignProducts($input: AssignProductsToChannelInput!) {
            assignProductsToChannel(input: $input) {
                id
            }
        }
    `);
    const duplicateEntity = graphql(`
        mutation SlugDuplicate($input: DuplicateEntityInput!) {
            duplicateEntity(input: $input) {
                ... on DuplicateEntitySuccess {
                    newEntityId
                }
                ... on DuplicateEntityError {
                    message
                }
            }
        }
    `);
    const slugForEntity = graphql(`
        query SlugSlugForEntity($input: SlugForEntityInput!) {
            slugForEntity(input: $input)
        }
    `);
    const createCollection = graphql(`
        mutation SlugCreateCollection($input: CreateCollectionInput!) {
            createCollection(input: $input) {
                id
                slug
            }
        }
    `);
    const assignCollections = graphql(`
        mutation SlugAssignCollections($input: AssignCollectionsToChannelInput!) {
            assignCollectionsToChannel(input: $input) {
                id
            }
        }
    `);
    const collectionBySlug = graphql(`
        query SlugCollectionBySlug($slug: String!) {
            collection(slug: $slug) {
                id
                slug
                name
            }
        }
    `);
    const shopProductBySlug = shopGraphql(`
        query SlugShopProductBySlug($slug: String!) {
            product(slug: $slug) {
                id
                name
            }
        }
    `);

    async function newProduct(token: string, name: string, slug: string) {
        adminClient.setChannelToken(token);
        const { createProduct: p } = await adminClient.query(createProduct, {
            input: {
                translations: [{ languageCode: LanguageCode.en, name, slug, description: '' }],
            },
        });
        return p;
    }

    async function newCollection(token: string, name: string, slug: string) {
        adminClient.setChannelToken(token);
        const { createCollection: c } = await adminClient.query(createCollection, {
            input: {
                filters: [],
                translations: [{ languageCode: LanguageCode.en, name, slug, description: '' }],
            },
        });
        return c;
    }

    async function lookup(token: string, slug: string) {
        adminClient.setChannelToken(token);
        const { product } = await adminClient.query(productBySlug, { slug });
        return product;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const [code, token] of [
            ['slug-b', B_TOKEN],
            ['slug-c', C_TOKEN],
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
            if (code === 'slug-b') {
                bChannelId = (createChannel as any).id;
            }
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #2843 — the reported flow: copy a product, move the copy to another channel,
    // give it back the original slug, then load it by slug in that channel.
    it('a copied product can take the original slug in another channel and be found by it', async () => {
        const original = await newProduct(E2E_DEFAULT_CHANNEL_TOKEN, 'Copy Me', 'copy-me');
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { duplicateEntity: dup } = await adminClient.query(duplicateEntity, {
            input: {
                entityName: 'Product',
                entityId: original.id,
                duplicatorInput: {
                    code: 'product-duplicator',
                    arguments: [{ name: 'includeVariants', value: 'false' }],
                },
            },
        });
        expect(dup).toEqual({ newEntityId: expect.anything() });
        const copyId = (dup as any).newEntityId;
        await adminClient.query(assignProducts, { input: { channelId: bChannelId, productIds: [copyId] } });

        adminClient.setChannelToken(B_TOKEN);
        const { updateProduct: renamed } = await adminClient.query(updateProduct, {
            input: {
                id: copyId,
                enabled: true,
                translations: [{ languageCode: LanguageCode.en, slug: 'copy-me' }],
            },
        });
        expect(renamed.slug).toBe('copy-me');

        expect((await lookup(B_TOKEN, 'copy-me'))?.id).toBe(copyId);
        shopClient.setChannelToken(B_TOKEN);
        const { product: shopResult } = await shopClient.query(shopProductBySlug, { slug: 'copy-me' });
        expect(shopResult?.id).toBe(copyId);
        // In the default channel the product that lives only there owns the slug.
        expect((await lookup(E2E_DEFAULT_CHANNEL_TOKEN, 'copy-me'))?.id).toBe(original.id);
    });

    it('the same slug can be used in two non-default channels', async () => {
        const inB = await newProduct(B_TOKEN, 'Shared B', 'shared');
        const inC = await newProduct(C_TOKEN, 'Shared C', 'shared');
        expect(inB.slug).toBe('shared');
        expect(inC.slug).toBe('shared');
        expect((await lookup(B_TOKEN, 'shared'))?.id).toBe(inB.id);
        expect((await lookup(C_TOKEN, 'shared'))?.id).toBe(inC.id);
    });

    // Gap 1: no conflict check when assigning to a channel.
    it('assigning a product to a channel where its slug is taken is rejected', async () => {
        await newProduct(B_TOKEN, 'Clash B', 'clash');
        const inC = await newProduct(C_TOKEN, 'Clash C', 'clash');
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        let error: any;
        try {
            await adminClient.query(assignProducts, {
                input: { channelId: bChannelId, productIds: [inC.id] },
            });
        } catch (e: any) {
            error = e;
        }
        expect(error?.message).toContain('clash');
        // And channel B must still resolve the slug to exactly its own product.
        expect((await lookup(B_TOKEN, 'clash'))?.name).toBe('Clash B');
    });

    // Gap 2: the validator only checks the active channel, not every channel the product is in.
    it('updating a slug checks every non-default channel the product belongs to', async () => {
        await newProduct(B_TOKEN, 'Taken in B', 'taken-in-b');
        const both = await newProduct(C_TOKEN, 'In B and C', 'in-b-and-c');
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(assignProducts, { input: { channelId: bChannelId, productIds: [both.id] } });

        adminClient.setChannelToken(C_TOKEN);
        const { updateProduct: updated } = await adminClient.query(updateProduct, {
            input: { id: both.id, translations: [{ languageCode: LanguageCode.en, slug: 'taken-in-b' }] },
        });
        expect(updated.slug).toBe('taken-in-b-2');
    });

    // Gap 3: the default channel holds every product, so lookups there must be deterministic.
    it('a default-channel lookup prefers the product that lives only in the default channel', async () => {
        const inB = await newProduct(B_TOKEN, 'Dflt B', 'dflt');
        const onlyDefault = await newProduct(E2E_DEFAULT_CHANNEL_TOKEN, 'Dflt Default', 'dflt');
        // A product that lives only in the default channel claims its slug across every channel.
        expect(onlyDefault.slug).toBe('dflt-2');
        expect((await lookup(B_TOKEN, 'dflt'))?.id).toBe(inB.id);

        // Two non-default products with the same slug: lowest id wins in the default channel.
        const c1 = await newProduct(B_TOKEN, 'Tie B', 'tie');
        await newProduct(C_TOKEN, 'Tie C', 'tie');
        expect((await lookup(E2E_DEFAULT_CHANNEL_TOKEN, 'tie'))?.id).toBe(c1.id);
    });

    // Gap 4: slugForEntity (the dashboard slug input) checks globally, so it suggests
    // "foo-1" when "foo" is free in the active channel, and leaks other channels' slugs.
    it('slugForEntity only considers the active channel', async () => {
        await newProduct(C_TOKEN, 'Only In C', 'only-in-c');
        adminClient.setChannelToken(B_TOKEN);
        const { slugForEntity: suggestion } = await adminClient.query(slugForEntity, {
            input: { entityName: 'Product', fieldName: 'slug', inputValue: 'Only In C' },
        });
        expect(suggestion).toBe('only-in-c');

        adminClient.setChannelToken(C_TOKEN);
        const { slugForEntity: inC } = await adminClient.query(slugForEntity, {
            input: { entityName: 'Product', fieldName: 'slug', inputValue: 'Only In C' },
        });
        expect(inC).toBe('only-in-c-1');
    });

    describe('collections', () => {
        it('the same collection slug can be used in two channels', async () => {
            const inB = await newCollection(B_TOKEN, 'Summer B', 'summer');
            const inC = await newCollection(C_TOKEN, 'Summer C', 'summer');
            expect(inB.slug).toBe('summer');
            expect(inC.slug).toBe('summer');
            adminClient.setChannelToken(B_TOKEN);
            expect((await adminClient.query(collectionBySlug, { slug: 'summer' })).collection?.id).toBe(
                inB.id,
            );
        });

        it('assigning a collection to a channel where its slug is taken is rejected', async () => {
            adminClient.setChannelToken(C_TOKEN);
            const cSummer = (await adminClient.query(collectionBySlug, { slug: 'summer' })).collection;
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            let error: any;
            try {
                await adminClient.query(assignCollections, {
                    input: { channelId: bChannelId, collectionIds: [cSummer?.id as string] },
                });
            } catch (e: any) {
                error = e;
            }
            expect(error?.message).toContain('summer');
        });

        it('a default-channel collection lookup is deterministic (lowest id)', async () => {
            adminClient.setChannelToken(B_TOKEN);
            const bSummer = (await adminClient.query(collectionBySlug, { slug: 'summer' })).collection;
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const fromDefault = (await adminClient.query(collectionBySlug, { slug: 'summer' })).collection;
            expect(fromDefault?.id).toBe(bSummer?.id);
        });
    });
});
