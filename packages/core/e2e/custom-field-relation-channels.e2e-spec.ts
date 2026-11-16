// this file relies on definitions that are only available at runtime, therefore we use gql here.
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { mergeConfig, Product, ProductVariant, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const SECOND_CHANNEL_TOKEN = 'relation-channels-second';

/**
 * Relation custom fields respect the Channel of the related entity, and in the Shop API, its
 * soft deletion and whether it is enabled.
 */
describe('Relation custom fields and Channels', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Product: [
                    { name: 'featured', type: 'relation', entity: Product },
                    { name: 'related', type: 'relation', entity: Product, list: true },
                    { name: 'featuredVariant', type: 'relation', entity: ProductVariant },
                    // An eager-loaded value must not bypass the Channel check.
                    { name: 'eagerVariant', type: 'relation', entity: ProductVariant, eager: true },
                ],
            },
        }),
    );
    let secondChannelProductId: string;

    const updateProduct = (input: any) =>
        adminClient.query(
            gql`
                mutation ($input: UpdateProductInput!) {
                    updateProduct(input: $input) {
                        id
                    }
                }
            `,
            { input },
        );

    const getCustomFields = async (client: typeof adminClient, id: string) => {
        const { product } = await client.query(
            gql`
                query ($id: ID!) {
                    product(id: $id) {
                        customFields {
                            featured {
                                id
                            }
                            related {
                                id
                            }
                            featuredVariant {
                                id
                            }
                            eagerVariant {
                                id
                            }
                        }
                    }
                }
            `,
            { id },
        );
        return product.customFields;
    };

    async function inChannel<T>(client: typeof adminClient, token: string, fn: () => Promise<T>) {
        client.setChannelToken(token);
        try {
            return await fn();
        } finally {
            client.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        }
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await adminClient.query(
            gql`
                mutation ($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'second',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            },
        );
        // Created in the second Channel, so it is in both the second and the default Channel.
        // The products from the CSV are only in the default Channel.
        const { createProduct } = await inChannel(adminClient, SECOND_CHANNEL_TOKEN, () =>
            adminClient.query(gql`
                mutation {
                    createProduct(
                        input: {
                            translations: [
                                { languageCode: en, name: "Second", slug: "second", description: "" }
                            ]
                        }
                    ) {
                        id
                    }
                }
            `),
        );
        secondChannelProductId = createProduct.id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('writing', () => {
        it('rejects a single relation to an entity which is not in the active Channel', async () => {
            await expect(
                inChannel(adminClient, SECOND_CHANNEL_TOKEN, () =>
                    updateProduct({ id: secondChannelProductId, customFields: { featuredId: 'T_1' } }),
                ),
            ).rejects.toThrow(/No Product with the id "(T_)?1" could be found/);
        });

        it('rejects a list relation to an entity which is not in the active Channel', async () => {
            await expect(
                inChannel(adminClient, SECOND_CHANNEL_TOKEN, () =>
                    updateProduct({
                        id: secondChannelProductId,
                        customFields: { relatedIds: [secondChannelProductId, 'T_1'] },
                    }),
                ),
            ).rejects.toThrow(/No Product with the id "(T_)?1" could be found/);
        });

        it('allows a relation to an entity in the active Channel', async () => {
            await updateProduct({ id: 'T_1', customFields: { featuredId: secondChannelProductId } });
            const cf = await getCustomFields(adminClient, 'T_1');
            expect(cf.featured).toEqual({ id: secondChannelProductId });
        });
    });

    describe('reading', () => {
        beforeAll(async () => {
            // Stored directly, as data written before relations were checked against the Channel.
            const id = secondChannelProductId.replace('T_', '');
            const dataSource = server.app.get(TransactionalConnection).rawConnection;
            await dataSource.getRepository(Product).update(id, {
                customFields: { featuredId: 1, eagerVariantId: 1, featuredVariantId: 1 },
            });
            await dataSource.createQueryBuilder().relation(Product, 'customFields.related').of(id).add(1);
        });

        it('does not return entities of another Channel in the Admin API', async () => {
            const cf = await inChannel(adminClient, SECOND_CHANNEL_TOKEN, () =>
                getCustomFields(adminClient, secondChannelProductId),
            );
            expect(cf).toEqual({ featured: null, related: [], featuredVariant: null, eagerVariant: null });
        });

        it('does not return entities of another Channel in the Shop API', async () => {
            const cf = await inChannel(shopClient, SECOND_CHANNEL_TOKEN, () =>
                getCustomFields(shopClient, secondChannelProductId),
            );
            expect(cf).toEqual({ featured: null, related: [], featuredVariant: null, eagerVariant: null });
        });

        // The list query joins relation custom fields, so these values arrive pre-loaded.
        it('filters pre-loaded values in a list query', async () => {
            const { products } = await inChannel(shopClient, SECOND_CHANNEL_TOKEN, () =>
                shopClient.query(gql`
                    {
                        products {
                            items {
                                id
                                customFields {
                                    featured {
                                        id
                                    }
                                    related {
                                        id
                                    }
                                    eagerVariant {
                                        id
                                    }
                                }
                            }
                        }
                    }
                `),
            );
            const item = products.items.find((p: any) => p.id === secondChannelProductId);
            expect(item.customFields).toEqual({ featured: null, related: [], eagerVariant: null });
        });

        it('returns them in the Channel they belong to', async () => {
            const cf = await getCustomFields(adminClient, secondChannelProductId);
            expect(cf.featured).toEqual({ id: 'T_1' });
            expect(cf.eagerVariant).toEqual({ id: 'T_1' });
            expect(cf.related).toEqual([{ id: 'T_1' }]);
        });
    });

    describe('Shop API visibility', () => {
        it('does not return a soft-deleted Product', async () => {
            await updateProduct({ id: 'T_2', customFields: { featuredId: 'T_3' } });
            await adminClient.query(gql`
                mutation {
                    deleteProduct(id: "T_3") {
                        result
                    }
                }
            `);
            expect((await getCustomFields(shopClient, 'T_2')).featured).toBeNull();
            // The Admin API still returns it.
            expect((await getCustomFields(adminClient, 'T_2')).featured).toEqual({ id: 'T_3' });
        });

        it('does not return a disabled ProductVariant', async () => {
            await updateProduct({ id: 'T_2', customFields: { featuredVariantId: 'T_1' } });
            expect((await getCustomFields(shopClient, 'T_2')).featuredVariant).toEqual({ id: 'T_1' });
            await adminClient.query(gql`
                mutation {
                    updateProductVariants(input: [{ id: "T_1", enabled: false }]) {
                        id
                    }
                }
            `);
            expect((await getCustomFields(shopClient, 'T_2')).featuredVariant).toBeNull();
            expect((await getCustomFields(adminClient, 'T_2')).featuredVariant).toEqual({ id: 'T_1' });
        });
    });
});
