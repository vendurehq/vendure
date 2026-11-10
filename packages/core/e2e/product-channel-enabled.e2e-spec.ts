/**
 * OSS-1001 spike: per-channel `enabled` for Products and ProductVariants, on top of the generic
 * channel assignment entities (one per ChannelAware entity, owning its `channels` junction table).
 *
 * `Product.enabled` / `ProductVariant.enabled` stay global. `enabledInChannel` is the nullable
 * per-channel value (`null` = not set). This prototype combines them as a master switch:
 * available in a Channel = enabled globally AND not disabled in that Channel.
 */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { awaitRunningJobs } from './utils/await-running-jobs';

const CHANNEL_B_TOKEN = 'channel_b_token';
const CHANNEL_C_TOKEN = 'channel_c_token';

const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                code
            }
        }
    }
`;

const ADMIN_PRODUCT = gql`
    query AdminProduct($id: ID!) {
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
`;

const ADMIN_PRODUCTS = gql`
    query AdminProducts($options: ProductListOptions) {
        products(options: $options) {
            totalItems
            items {
                id
                enabled
                enabledInChannel
            }
        }
    }
`;

const ADMIN_VARIANTS = gql`
    query AdminVariants($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            totalItems
            items {
                id
                enabled
                enabledInChannel
            }
        }
    }
`;

const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            enabled
            enabledInChannel
        }
    }
`;

const UPDATE_VARIANTS = gql`
    mutation UpdateVariants($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            id
            enabled
            enabledInChannel
        }
    }
`;

const CREATE_PRODUCT = gql`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
            enabled
            enabledInChannel
        }
    }
`;

const ASSIGN_PRODUCTS = gql`
    mutation AssignProducts($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
        }
    }
`;

const ASSIGN_VARIANTS = gql`
    mutation AssignVariants($input: AssignProductVariantsToChannelInput!) {
        assignProductVariantsToChannel(input: $input) {
            id
        }
    }
`;

const SHOP_PRODUCT = gql`
    query ShopProduct($id: ID!) {
        product(id: $id) {
            id
            enabled
            variants {
                id
            }
        }
    }
`;

const SHOP_PRODUCTS = gql`
    query ShopProducts($options: ProductListOptions) {
        products(options: $options) {
            items {
                id
            }
        }
    }
`;

const SHOP_SEARCH = gql`
    query ShopSearch($input: SearchInput!) {
        search(input: $input) {
            items {
                productId
                productVariantId
            }
        }
    }
`;

const ADD_ITEM = gql`
    mutation AddItem($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ... on Order {
                id
                lines {
                    productVariant {
                        id
                    }
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

describe('Per-channel enabled for Products and ProductVariants (OSS-1001)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DefaultSearchPlugin, DefaultJobQueuePlugin],
        }),
    );

    let channelCId: string;

    async function asChannel(token: string) {
        adminClient.setChannelToken(token);
        shopClient.setChannelToken(token);
    }

    async function shopProductIds() {
        const { products } = await shopClient.query(SHOP_PRODUCTS, { options: { take: 100 } });
        return products.items.map((p: any) => p.id);
    }

    async function searchVariantIds(term: string) {
        await awaitRunningJobs(adminClient);
        const { search } = await shopClient.query(SHOP_SEARCH, { input: { term, groupByProduct: false } });
        return search.items.map((i: any) => i.productVariantId).sort();
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
            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
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
            if (code === 'channel-c') {
                channelCId = createChannel.id;
            }
        }
        // Product T_1 (Laptop, variants T_1..T_4) and T_2 (Curvy Monitor, T_5..T_6) go into channel B
        await adminClient.query(ASSIGN_PRODUCTS, {
            input: { channelId: 'T_2', productIds: ['T_1', 'T_2'] },
        });
        await awaitRunningJobs(adminClient);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('product', () => {
        it('the per-channel value is not set by default', async () => {
            for (const token of [E2E_DEFAULT_CHANNEL_TOKEN, CHANNEL_B_TOKEN]) {
                await asChannel(token);
                const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
                expect(product.enabled).toBe(true);
                expect(product.enabledInChannel).toBeNull();
            }
        });

        it('disabling in channel B leaves the global value and the default channel alone', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            const { updateProduct } = await adminClient.query(UPDATE_PRODUCT, {
                input: { id: 'T_1', enabledInChannel: false },
            });
            expect(updateProduct.enabled).toBe(true);
            expect(updateProduct.enabledInChannel).toBe(false);

            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
            expect(product.enabled).toBe(true);
            expect(product.enabledInChannel).toBeNull();
        });

        it('Admin products list filters on the active channel value', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            const { products: inB } = await adminClient.query(ADMIN_PRODUCTS, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inB.items.map((p: any) => p.id)).toEqual(['T_1']);

            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { products: inDefault } = await adminClient.query(ADMIN_PRODUCTS, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inDefault.totalItems).toBe(0);
        });

        it('Shop API hides it in channel B only', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            const { product: inB } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
            expect(inB).toBeNull();
            expect(await shopProductIds()).toEqual(['T_2']);

            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: inDefault } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
            expect(inDefault?.id).toBe('T_1');
            expect(await shopProductIds()).toContain('T_1');
        });

        it('cannot add its variant to a channel B order, can in the default channel', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            await expect(shopClient.query(ADD_ITEM, { productVariantId: 'T_1', quantity: 1 })).rejects.toThrow(
                'No ProductVariant with the id',
            );

            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, { productVariantId: 'T_1', quantity: 1 });
            expect(addItemToOrder.lines.map((l: any) => l.productVariant.id)).toEqual(['T_1']);
        });

        it('search is per channel', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            expect(await searchVariantIds('laptop')).toEqual([]);
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            expect(await searchVariantIds('laptop')).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
        });

        it('clearing the channel value (null) makes it visible in channel B again', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            const { updateProduct } = await adminClient.query(UPDATE_PRODUCT, {
                input: { id: 'T_1', enabledInChannel: null },
            });
            expect(updateProduct.enabledInChannel).toBeNull();
            const { product } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
            expect(product?.id).toBe('T_1');
        });

        it('the global value is a master switch: disabled globally hides it in every channel', async () => {
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(UPDATE_PRODUCT, { input: { id: 'T_2', enabled: false } });
            expect(await shopProductIds()).not.toContain('T_2');
            await asChannel(CHANNEL_B_TOKEN);
            // enabledInChannel: true in B does not override the global switch
            await adminClient.query(UPDATE_PRODUCT, { input: { id: 'T_2', enabledInChannel: true } });
            expect(await shopProductIds()).not.toContain('T_2');

            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(UPDATE_PRODUCT, { input: { id: 'T_2', enabled: true } });
            await asChannel(CHANNEL_B_TOKEN);
            expect(await shopProductIds()).toContain('T_2');
        });
    });

    describe('variant', () => {
        it('disabling a variant in the default channel leaves it available in channel B', async () => {
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { updateProductVariants } = await adminClient.query(UPDATE_VARIANTS, {
                input: [{ id: 'T_2', enabledInChannel: false }],
            });
            expect(updateProductVariants[0].enabled).toBe(true);
            expect(updateProductVariants[0].enabledInChannel).toBe(false);

            await asChannel(CHANNEL_B_TOKEN);
            const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
            expect(product.variants.find((v: any) => v.id === 'T_2').enabledInChannel).toBeNull();
        });

        it('Admin productVariants list filters on the active channel value', async () => {
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { productVariants: inDefault } = await adminClient.query(ADMIN_VARIANTS, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inDefault.items.map((v: any) => v.id)).toEqual(['T_2']);

            await asChannel(CHANNEL_B_TOKEN);
            const { productVariants: inB } = await adminClient.query(ADMIN_VARIANTS, {
                options: { filter: { enabledInChannel: { eq: false } } },
            });
            expect(inB.totalItems).toBe(0);
        });

        it('Shop API product.variants and search are filtered per channel', async () => {
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: inDefault } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
            expect(inDefault.variants.map((v: any) => v.id)).toEqual(['T_1', 'T_3', 'T_4']);
            expect(await searchVariantIds('laptop')).toEqual(['T_1', 'T_3', 'T_4']);

            await asChannel(CHANNEL_B_TOKEN);
            const { product: inB } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
            expect(inB.variants.map((v: any) => v.id)).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
            expect(await searchVariantIds('laptop')).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);
        });

        it('addItemToOrder respects the channel value of the variant', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            const { addItemToOrder } = await shopClient.query(ADD_ITEM, { productVariantId: 'T_2', quantity: 1 });
            expect(addItemToOrder.lines.map((l: any) => l.productVariant.id)).toContain('T_2');
        });
    });

    describe('creating and assigning', () => {
        it('createProduct with enabledInChannel: false sets only the active channel', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            const { createProduct } = await adminClient.query(CREATE_PRODUCT, {
                input: {
                    enabledInChannel: false,
                    translations: [
                        { languageCode: LanguageCode.en, name: 'B only', slug: 'b-only', description: '' },
                    ],
                },
            });
            expect(createProduct.enabled).toBe(true);
            expect(createProduct.enabledInChannel).toBe(false);

            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(ADMIN_PRODUCT, { id: createProduct.id });
            expect(product.enabledInChannel).toBeNull();
        });

        it('assignProductsToChannel with an explicit enabledInChannel', async () => {
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(ASSIGN_PRODUCTS, {
                input: { channelId: channelCId, productIds: ['T_1'], enabledInChannel: false },
            });
            await asChannel(CHANNEL_C_TOKEN);
            const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
            expect(product.enabledInChannel).toBe(false);
            expect(product.variants.every((v: any) => v.enabledInChannel === false)).toBe(true);
        });

        it('assigning without enabledInChannel copies the per-channel data from the active channel', async () => {
            await asChannel(CHANNEL_B_TOKEN);
            await adminClient.query(UPDATE_VARIANTS, { input: [{ id: 'T_5', enabledInChannel: false }] });
            await adminClient.query(ASSIGN_PRODUCTS, {
                input: { channelId: channelCId, productIds: ['T_2'] },
            });
            await asChannel(CHANNEL_C_TOKEN);
            const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_2' });
            // T_2 was set to true in channel B by the master-switch test
            expect(product.enabledInChannel).toBe(true);
            expect(product.variants.find((v: any) => v.id === 'T_5').enabledInChannel).toBe(false);
            expect(product.variants.find((v: any) => v.id === 'T_6').enabledInChannel).toBeNull();
        });

        it('assignProductVariantsToChannel with an explicit enabledInChannel', async () => {
            await asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(ASSIGN_VARIANTS, {
                input: { channelId: channelCId, productVariantIds: ['T_7'], enabledInChannel: false },
            });
            await asChannel(CHANNEL_C_TOKEN);
            const { productVariants } = await adminClient.query(ADMIN_VARIANTS, {
                options: { filter: { id: { eq: 'T_7' } } },
            });
            expect(productVariants.items[0].enabledInChannel).toBe(false);
        });
    });

    describe('channel assignment rows', () => {
        const CHANNEL_AWARE = [
            'Asset',
            'ApiKey',
            'Collection',
            'Customer',
            'Facet',
            'FacetValue',
            'Order',
            'PaymentMethod',
            'Product',
            'ProductOption',
            'ProductOptionGroup',
            'ProductVariant',
            'Promotion',
            'ShippingMethod',
            'StockLocation',
        ];

        it('schema synchronization keeps the junction rows and per-channel values', async () => {
            const dataSource = server.app.get(TransactionalConnection).rawConnection;
            const count = async () => {
                const result: Record<string, number> = {};
                for (const name of CHANNEL_AWARE) {
                    result[name] = await dataSource.getRepository(`${name}Channel`).count();
                }
                return result;
            };
            const repo = dataSource.getRepository('ProductVariantChannel');
            // Self-contained: write a per-channel value so the test does not depend on earlier tests
            await repo.update({ productVariantId: 3, channelId: 1 }, { enabled: false });
            const disabled = () =>
                repo.find({ where: { enabled: false }, order: { productVariantId: 'ASC', channelId: 'ASC' } });
            const before = await count();
            const disabledBefore = await disabled();
            expect(disabledBefore.length).toBeGreaterThan(0);

            await dataSource.synchronize();
            await dataSource.synchronize();

            expect(await count()).toEqual(before);
            expect(await disabled()).toEqual(disabledBefore);
        });
    });
});
