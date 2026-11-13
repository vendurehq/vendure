/**
 * Per-channel `enabled` for Products and ProductVariants (#3777).
 *
 * `Product.enabled` / `ProductVariant.enabled` stay global. `enabledInChannel` is the per-channel
 * value, `true` by default. They combine as a master switch (see `ChannelEnabledChecker`):
 * available in a Channel = enabled globally AND enabled in that Channel.
 *
 * The tests run in order and share the state they set up, like the other e2e specs.
 */
import { CurrencyCode, LanguageCode, SortOrder } from '@vendure/common/lib/generated-types';
import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import type { ErrorResultGuard } from '@vendure/testing';
import { createErrorResultGuard, createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import { FragmentOf as ShopFragmentOf, graphql as shopGraphql } from './graphql/graphql-shop';
import {
    assignCollectionsToChannelDocument,
    assignProductToChannelDocument,
    assignProductVariantToChannelDocument,
    createChannelDocument,
    createCollectionDocument,
    createProductDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    searchProductsShopDocument,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

const CHANNEL_B_TOKEN = 'channel_b_token';
const CHANNEL_C_TOKEN = 'channel_c_token';

const adminProductDocument = graphql(`
    query AdminProductEnabledInChannel($id: ID!) {
        product(id: $id) {
            id
            enabled
            enabledInChannel
            variants {
                id
                enabled
                enabledInChannel
            }
        }
    }
`);

const adminProductsDocument = graphql(`
    query AdminProductsEnabledInChannel($options: ProductListOptions) {
        products(options: $options) {
            totalItems
            items {
                id
                enabled
                enabledInChannel
            }
        }
    }
`);

const adminVariantsDocument = graphql(`
    query AdminVariantsEnabledInChannel($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            totalItems
            items {
                id
                enabled
                enabledInChannel
            }
        }
    }
`);

const adminCollectionVariantsDocument = graphql(`
    query AdminCollectionVariantsEnabledInChannel($id: ID!, $options: ProductVariantListOptions) {
        collection(id: $id) {
            productVariants(options: $options) {
                items {
                    id
                }
            }
        }
    }
`);

const shopProductDocument = shopGraphql(`
    query ShopProductEnabledInChannel($id: ID!) {
        product(id: $id) {
            id
            enabled
            variants {
                id
            }
        }
    }
`);

const shopProductsDocument = shopGraphql(`
    query ShopProductsEnabledInChannel($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
            }
        }
    }
`);

const shopCollectionVariantsDocument = shopGraphql(`
    query ShopCollectionVariantsEnabledInChannel($id: ID!) {
        collection(id: $id) {
            productVariants {
                items {
                    id
                }
            }
        }
    }
`);

describe('Per-channel enabled for Products and ProductVariants (#3777)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DefaultSearchPlugin, DefaultJobQueuePlugin],
        }),
    );

    const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
        input => !!input.id,
    );
    const orderResultGuard: ErrorResultGuard<ShopFragmentOf<typeof updatedOrderFragment>> =
        createErrorResultGuard(input => !!input.lines);
    let channelCId: string;

    function asChannel(token: string) {
        adminClient.setChannelToken(token);
        shopClient.setChannelToken(token);
    }

    async function adminProduct(id: string) {
        const { product } = await adminClient.query(adminProductDocument, { id });
        if (!product) {
            throw new Error(`Product ${id} not found`);
        }
        return product;
    }

    async function shopProductIds() {
        const { products } = await shopClient.query(shopProductsDocument, { options: { take: 100 } });
        return products.items.map(p => p.id);
    }

    async function searchVariantIds(term: string) {
        await awaitRunningJobs(adminClient);
        const { search } = await shopClient.query(searchProductsShopDocument, {
            input: { term, groupByProduct: false },
        });
        return search.items.map(i => i.productVariantId).sort();
    }

    async function addItemToOrder(productVariantId: string) {
        const { addItemToOrder: result } = await shopClient.query(addItemToOrderDocument, {
            productVariantId,
            quantity: 1,
        });
        return result;
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await awaitRunningJobs(adminClient, 10_000, 1000);

        for (const [code, token] of [
            ['channel-b', CHANNEL_B_TOKEN],
            ['channel-c', CHANNEL_C_TOKEN],
        ]) {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelGuard.assertSuccess(createChannel);
            if (code === 'channel-c') {
                channelCId = createChannel.id;
            }
        }
        // Product T_1 (Laptop, variants T_1..T_4) and T_2 (Curvy Monitor, T_5..T_6) go into channel B
        await adminClient.query(assignProductToChannelDocument, {
            input: { channelId: 'T_2', productIds: ['T_1', 'T_2'] },
        });
        await awaitRunningJobs(adminClient);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('product', () => {
        it('is enabled in every channel by default', async () => {
            for (const token of [E2E_DEFAULT_CHANNEL_TOKEN, CHANNEL_B_TOKEN]) {
                asChannel(token);
                const product = await adminProduct('T_1');
                expect(product.enabled).toBe(true);
                expect(product.enabledInChannel).toBe(true);
            }
        });

        it('disabling in channel B leaves the global value and the default channel alone', async () => {
            asChannel(CHANNEL_B_TOKEN);
            await adminClient.query(updateProductDocument, {
                input: { id: 'T_1', enabledInChannel: false },
            });
            const inB = await adminProduct('T_1');
            expect(inB.enabled).toBe(true);
            expect(inB.enabledInChannel).toBe(false);

            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const inDefault = await adminProduct('T_1');
            expect(inDefault.enabled).toBe(true);
            expect(inDefault.enabledInChannel).toBe(true);
        });

        it('Admin products list filters on the active channel value', async () => {
            asChannel(CHANNEL_B_TOKEN);
            const { products: inB } = await adminClient.query(adminProductsDocument, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inB.items.map(p => p.id)).toEqual(['T_1']);
            expect(inB.items.map(p => p.enabledInChannel)).toEqual([false]);

            // Each item resolves `enabledInChannel` from the row loaded by the list query
            const { products: allInB } = await adminClient.query(adminProductsDocument, {
                options: { sort: { id: SortOrder.ASC }, take: 2 },
            });
            expect(allInB.items.map(p => [p.id, p.enabledInChannel])).toEqual([
                ['T_1', false],
                ['T_2', true],
            ]);

            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { products: inDefault } = await adminClient.query(adminProductsDocument, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inDefault.totalItems).toBe(0);
        });

        it('Shop API hides it in channel B only', async () => {
            asChannel(CHANNEL_B_TOKEN);
            const { product: inB } = await shopClient.query(shopProductDocument, { id: 'T_1' });
            expect(inB).toBeNull();
            expect(await shopProductIds()).toEqual(['T_2']);

            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: inDefault } = await shopClient.query(shopProductDocument, { id: 'T_1' });
            expect(inDefault?.id).toBe('T_1');
            expect(await shopProductIds()).toContain('T_1');
        });

        it('cannot add its variant to a channel B order, can in the default channel', async () => {
            asChannel(CHANNEL_B_TOKEN);
            await expect(addItemToOrder('T_1')).rejects.toThrow('No ProductVariant with the id');

            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const result = await addItemToOrder('T_1');
            orderResultGuard.assertSuccess(result);
            expect(result.lines.map(l => l.productVariant.id)).toEqual(['T_1']);
        });

        it('search is per channel', async () => {
            asChannel(CHANNEL_B_TOKEN);
            expect(await searchVariantIds('laptop')).toEqual([]);
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            expect(await searchVariantIds('laptop')).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
        });

        it('omitting enabledInChannel, or passing null, leaves the channel value unchanged', async () => {
            asChannel(CHANNEL_B_TOKEN);
            await adminClient.query(updateProductDocument, { input: { id: 'T_1' } });
            expect((await adminProduct('T_1')).enabledInChannel).toBe(false);
            await adminClient.query(updateProductDocument, {
                input: { id: 'T_1', enabledInChannel: null },
            });
            expect((await adminProduct('T_1')).enabledInChannel).toBe(false);
        });

        it('enabling it in channel B again makes it visible there', async () => {
            asChannel(CHANNEL_B_TOKEN);
            await adminClient.query(updateProductDocument, {
                input: { id: 'T_1', enabledInChannel: true },
            });
            expect((await adminProduct('T_1')).enabledInChannel).toBe(true);
            const { product } = await shopClient.query(shopProductDocument, { id: 'T_1' });
            expect(product?.id).toBe('T_1');
        });

        it('the global value is a master switch: disabled globally hides it in every channel', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(updateProductDocument, { input: { id: 'T_2', enabled: false } });
            expect(await shopProductIds()).not.toContain('T_2');
            asChannel(CHANNEL_B_TOKEN);
            // enabledInChannel: true in B does not override the global switch
            expect((await adminProduct('T_2')).enabledInChannel).toBe(true);
            expect(await shopProductIds()).not.toContain('T_2');

            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(updateProductDocument, { input: { id: 'T_2', enabled: true } });
            asChannel(CHANNEL_B_TOKEN);
            expect(await shopProductIds()).toContain('T_2');
        });
    });

    describe('variant', () => {
        it('disabling a variant in the default channel leaves it available in channel B', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: 'T_2', enabledInChannel: false }],
            });
            expect(updateProductVariants[0]?.enabled).toBe(true);
            const inDefault = await adminProduct('T_1');
            expect(inDefault.variants.find(v => v.id === 'T_2')?.enabledInChannel).toBe(false);

            asChannel(CHANNEL_B_TOKEN);
            const inB = await adminProduct('T_1');
            expect(inB.variants.find(v => v.id === 'T_2')?.enabledInChannel).toBe(true);
        });

        it('Admin productVariants list filters on the active channel value', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { productVariants: inDefault } = await adminClient.query(adminVariantsDocument, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inDefault.items.map(v => v.id)).toEqual(['T_2']);

            asChannel(CHANNEL_B_TOKEN);
            const { productVariants: inB } = await adminClient.query(adminVariantsDocument, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inB.totalItems).toBe(0);
        });

        it('Shop API product.variants and search are filtered per channel', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: inDefault } = await shopClient.query(shopProductDocument, { id: 'T_1' });
            expect(inDefault?.variants.map(v => v.id)).toEqual(['T_1', 'T_3', 'T_4']);
            expect(await searchVariantIds('laptop')).toEqual(['T_1', 'T_3', 'T_4']);

            asChannel(CHANNEL_B_TOKEN);
            const { product: inB } = await shopClient.query(shopProductDocument, { id: 'T_1' });
            expect(inB?.variants.map(v => v.id)).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
            expect(await searchVariantIds('laptop')).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
        });

        it('addItemToOrder respects the channel value of the variant', async () => {
            asChannel(CHANNEL_B_TOKEN);
            const result = await addItemToOrder('T_2');
            orderResultGuard.assertSuccess(result);
            expect(result.lines.map(l => l.productVariant.id)).toContain('T_2');
        });

        it('addItemToOrder rejects a variant disabled in the active channel', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await expect(addItemToOrder('T_2')).rejects.toThrow('No ProductVariant with the id');
        });

        it('addItemToOrder rejects a variant which is not assigned to the active channel', async () => {
            // T_7 belongs to product T_3, which is only in the default channel
            asChannel(CHANNEL_B_TOKEN);
            await expect(addItemToOrder('T_7')).rejects.toThrow('No ProductVariant with the id');
        });

        it('Shop API Collection.productVariants is filtered per channel; Admin API is not', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { createCollection } = await adminClient.query(createCollectionDocument, {
                input: {
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Laptops', slug: 'laptops', description: '' },
                    ],
                    filters: [
                        {
                            code: 'variant-id-filter',
                            arguments: [
                                { name: 'variantIds', value: '["T_1", "T_2", "T_3", "T_4"]' },
                                { name: 'combineWithAnd', value: 'true' },
                            ],
                        },
                    ],
                },
            });
            await adminClient.query(assignCollectionsToChannelDocument, {
                input: { channelId: 'T_2', collectionIds: [createCollection.id] },
            });
            await awaitRunningJobs(adminClient);
            const shopVariantIds = async () => {
                const { collection } = await shopClient.query(shopCollectionVariantsDocument, {
                    id: createCollection.id,
                });
                return collection?.productVariants.items.map(v => v.id).sort();
            };
            // T_2 is disabled in the default channel only
            expect(await shopVariantIds()).toEqual(['T_1', 'T_3', 'T_4']);
            // In the Admin API, `enabled` filters on the global value
            const { collection: adminCollection } = await adminClient.query(adminCollectionVariantsDocument, {
                id: createCollection.id,
                options: { filter: { enabled: { eq: true } } },
            });
            expect(adminCollection?.productVariants.items.map(v => v.id).sort()).toEqual([
                'T_1',
                'T_2',
                'T_3',
                'T_4',
            ]);
            asChannel(CHANNEL_B_TOKEN);
            expect(await shopVariantIds()).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
        });
    });

    describe('creating and assigning', () => {
        it('createProduct with enabledInChannel: false sets only the active channel', async () => {
            asChannel(CHANNEL_B_TOKEN);
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    enabledInChannel: false,
                    translations: [
                        { languageCode: LanguageCode.en, name: 'B only', slug: 'b-only', description: '' },
                    ],
                },
            });
            const inB = await adminProduct(createProduct.id);
            expect(inB.enabled).toBe(true);
            expect(inB.enabledInChannel).toBe(false);

            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            expect((await adminProduct(createProduct.id)).enabledInChannel).toBe(true);
        });

        it('assignProductsToChannel with an explicit enabledInChannel', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: channelCId, productIds: ['T_1'], enabledInChannel: false },
            });
            asChannel(CHANNEL_C_TOKEN);
            const product = await adminProduct('T_1');
            expect(product.enabledInChannel).toBe(false);
            expect(product.variants.every(v => v.enabledInChannel === false)).toBe(true);
        });

        it('assigning without enabledInChannel copies the per-channel data from the active channel', async () => {
            asChannel(CHANNEL_B_TOKEN);
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: 'T_5', enabledInChannel: false }],
            });
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: channelCId, productIds: ['T_2'] },
            });
            asChannel(CHANNEL_C_TOKEN);
            const product = await adminProduct('T_2');
            expect(product.enabledInChannel).toBe(true);
            expect(product.variants.find(v => v.id === 'T_5')?.enabledInChannel).toBe(false);
            expect(product.variants.find(v => v.id === 'T_6')?.enabledInChannel).toBe(true);
        });

        it('assignProductVariantsToChannel with an explicit enabledInChannel', async () => {
            asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(assignProductVariantToChannelDocument, {
                input: { channelId: channelCId, productVariantIds: ['T_7'], enabledInChannel: false },
            });
            asChannel(CHANNEL_C_TOKEN);
            const { productVariants } = await adminClient.query(adminVariantsDocument, {
                options: { filter: { id: { eq: 'T_7' } } },
            });
            expect(productVariants.items[0]?.enabledInChannel).toBe(false);
        });
    });

    describe('schema synchronization', () => {
        it('keeps the per-channel values', async () => {
            const dataSource = server.app.get(TransactionalConnection).rawConnection;
            const repo = dataSource.getRepository('ProductVariantChannel');
            const disabled = () =>
                repo.find({
                    where: { enabled: false },
                    order: { productVariantId: 'ASC', channelId: 'ASC' },
                });
            const disabledBefore = await disabled();
            expect(disabledBefore.length).toBeGreaterThan(0);

            await dataSource.synchronize();
            await dataSource.synchronize();

            expect(await disabled()).toEqual(disabledBefore);
        });
    });
});
