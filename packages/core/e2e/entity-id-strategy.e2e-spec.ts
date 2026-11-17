/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { sortById } from './utils/test-order-utils';

describe('EntityIdStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('encodes ids', async () => {
        const { products } = await shopClient.query(idTest1Query);
        expect(products.items.sort(sortById)).toEqual([
            { id: 'T_1' },
            { id: 'T_2' },
            { id: 'T_3' },
            { id: 'T_4' },
            { id: 'T_5' },
        ]);
    });

    it('Does not doubly-encode ids from resolved properties', async () => {
        const { products } = await shopClient.query(idTest2Query);

        expect(products.items[0].id).toBe('T_1');
        expect(products.items[0].variants[0].id).toBe('T_1');
        expect(products.items[0].variants[0].options.map(o => o.id).sort()).toEqual(['T_1', 'T_3']);
    });

    it('decodes embedded argument', async () => {
        const { product } = await shopClient.query(idTest3Query);
        expect(product).toEqual({
            id: 'T_1',
        });
    });

    it('decodes embedded nested id', async () => {
        const { updateProduct } = await adminClient.query(idTest4Mutation);
        expect(updateProduct).toEqual({
            id: 'T_1',
            featuredAsset: {
                id: 'T_3',
            },
        });
    });

    it('decodes embedded nested object id', async () => {
        const { updateProduct } = await adminClient.query(idTest5Mutation);
        expect(updateProduct).toEqual({
            id: 'T_1',
            name: 'changed',
        });
    });

    it('decodes argument as variable', async () => {
        const { product } = await shopClient.query(idTest6Query, { id: 'T_1' });
        expect(product).toEqual({
            id: 'T_1',
        });
    });

    it('decodes nested id as variable', async () => {
        const { updateProduct } = await adminClient.query(idTest7Mutation, {
            input: {
                id: 'T_1',
                featuredAssetId: 'T_2',
            },
        });
        expect(updateProduct).toEqual({
            id: 'T_1',
            featuredAsset: {
                id: 'T_2',
            },
        });
    });

    it('decodes nested object id as variable', async () => {
        const { updateProduct } = await adminClient.query(idTest8Mutation, {
            input: {
                id: 'T_1',
                translations: [{ id: 'T_1', languageCode: LanguageCode.en, name: 'changed again' }],
            },
        });
        expect(updateProduct).toEqual({
            id: 'T_1',
            name: 'changed again',
        });
    });

    it('encodes ids in fragment', async () => {
        const { products } = await shopClient.query(idTest9Query);

        expect(products).toEqual({
            items: [
                {
                    id: 'T_1',
                    featuredAsset: {
                        id: 'T_2',
                    },
                },
            ],
        });
    });

    it('encodes ids in doubly-nested fragment', async () => {
        const { products } = await shopClient.query(idTest10Query);

        expect(products).toEqual({
            items: [
                {
                    id: 'T_1',
                    featuredAsset: {
                        id: 'T_2',
                    },
                },
            ],
        });
    });

    it('encodes ids in triply-nested fragment', async () => {
        const { products } = await shopClient.query(idTest11Query);

        expect(products).toEqual({
            items: [
                {
                    id: 'T_1',
                    featuredAsset: {
                        id: 'T_2',
                    },
                },
            ],
        });
    });

    // #5511 — ID arguments of a field inside a named fragment must be decoded
    it('decodes id variable in named fragment', async () => {
        const { updateProduct } = await adminClient.query(idTest12Mutation, {
            input: { id: 'T_1', featuredAssetId: 'T_3' },
        });
        expect(updateProduct).toEqual({
            id: 'T_1',
            featuredAsset: {
                id: 'T_3',
            },
        });
    });

    // #5511 — ID arguments of a field inside a fragment spread from another fragment must be decoded
    it('decodes id variable in nested named fragment', async () => {
        const { product } = await adminClient.query(idTest13Query, { id: 'T_2' });
        expect(product).toEqual({ id: 'T_2' });
    });

    // #5511 — `updateProduct` and `createProduct` both take an argument named `input`.
    // `CreateProductInput` has no `id` field. Decoding the `input` of `updateProduct` with the type of
    // the later `createProduct` argument leaves `input.id` encoded.
    it('decodes id variable when a sibling field has an argument of the same name', async () => {
        const { updateProduct, createProduct } = await adminClient.query(idTest14Mutation, {
            update: { id: 'T_1', featuredAssetId: 'T_2' },
            create: {
                featuredAssetId: 'T_3',
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'sibling create',
                        slug: 'sibling-create',
                        description: '',
                    },
                ],
            },
        });
        expect(updateProduct).toEqual({
            id: 'T_1',
            featuredAsset: {
                id: 'T_2',
            },
        });
        expect(createProduct.featuredAsset).toEqual({ id: 'T_3' });
    });
});

const idTest1Query = graphql(`
    query IdTest1 {
        products(options: { take: 5 }) {
            items {
                id
            }
        }
    }
`);

const idTest2Query = graphql(`
    query IdTest2 {
        products(options: { take: 1 }) {
            items {
                id
                variants {
                    id
                    options {
                        id
                        name
                    }
                }
            }
        }
    }
`);

const idTest3Query = graphql(`
    query IdTest3 {
        product(id: "T_1") {
            id
        }
    }
`);

const idTest4Mutation = graphql(`
    mutation IdTest4 {
        updateProduct(input: { id: "T_1", featuredAssetId: "T_3" }) {
            id
            featuredAsset {
                id
            }
        }
    }
`);

const idTest5Mutation = graphql(`
    mutation IdTest5 {
        updateProduct(
            input: { id: "T_1", translations: [{ id: "T_1", languageCode: en, name: "changed" }] }
        ) {
            id
            name
        }
    }
`);

const idTest6Query = graphql(`
    query IdTest6($id: ID!) {
        product(id: $id) {
            id
        }
    }
`);

const idTest7Mutation = graphql(`
    mutation IdTest7($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            featuredAsset {
                id
            }
        }
    }
`);

const idTest8Mutation = graphql(`
    mutation IdTest8($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            name
        }
    }
`);

const idTest9Query = graphql(`
    query IdTest9 {
        products(options: { take: 1 }) {
            items {
                ...ProdFragment
            }
        }
    }
    fragment ProdFragment on Product {
        id
        featuredAsset {
            id
        }
    }
`);

const idTest10Query = graphql(`
    query IdTest10 {
        products(options: { take: 1 }) {
            items {
                ...ProdFragment1
            }
        }
    }
    fragment ProdFragment1 on Product {
        ...ProdFragment2
    }
    fragment ProdFragment2 on Product {
        id
        featuredAsset {
            id
        }
    }
`);

const idTest11Query = graphql(`
    query IdTest11 {
        products(options: { take: 1 }) {
            items {
                ...ProdFragment1_1
            }
        }
    }
    fragment ProdFragment1_1 on Product {
        ...ProdFragment2_1
    }
    fragment ProdFragment2_1 on Product {
        ...ProdFragment3_1
    }
    fragment ProdFragment3_1 on Product {
        id
        featuredAsset {
            id
        }
    }
`);

const idTest12Mutation = graphql(`
    mutation IdTest12($input: UpdateProductInput!) {
        ...IdTest12Fields
    }
    fragment IdTest12Fields on Mutation {
        updateProduct(input: $input) {
            id
            featuredAsset {
                id
            }
        }
    }
`);

const idTest13Query = graphql(`
    query IdTest13($id: ID!) {
        ...IdTest13Outer
    }
    fragment IdTest13Outer on Query {
        ...IdTest13Inner
    }
    fragment IdTest13Inner on Query {
        product(id: $id) {
            id
        }
    }
`);

const idTest14Mutation = graphql(`
    mutation IdTest14($update: UpdateProductInput!, $create: CreateProductInput!) {
        updateProduct(input: $update) {
            id
            featuredAsset {
                id
            }
        }
        createProduct(input: $create) {
            id
            featuredAsset {
                id
            }
        }
    }
`);
