/**
 * OSS-1001 spike: proof of concept for channel-scoped custom fields (#490).
 *
 * A custom field with `channelScoped: true` is stored on the entity's channel assignment row
 * (here `ProductChannel`), and the normal `customFields` API reads and writes the value of the
 * active Channel.
 */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { Asset, mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const CHANNEL_B_TOKEN = 'cf_channel_b_token';
const CHANNEL_C_TOKEN = 'cf_channel_c_token';

const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
            }
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

const PRODUCT_FIELDS = `
    id
    customFields {
        channelNote
        globalNote
        channelFeaturedAsset {
            id
        }
    }
`;

const ADMIN_PRODUCT = gql`
    query AdminProduct($id: ID!) {
        product(id: $id) {
            ${PRODUCT_FIELDS}
        }
    }
`;

const ADMIN_PRODUCTS = gql`
    query AdminProducts($options: ProductListOptions) {
        products(options: $options) {
            totalItems
            items {
                ${PRODUCT_FIELDS}
            }
        }
    }
`;

const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            ${PRODUCT_FIELDS}
        }
    }
`;

const SHOP_PRODUCT = gql`
    query ShopProduct($id: ID!) {
        product(id: $id) {
            id
            customFields {
                channelNote
                globalNote
            }
        }
    }
`;

describe('Channel-scoped custom fields (OSS-1001 PoC, #490)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                Product: [
                    { name: 'channelNote', type: 'string', channelScoped: true, nullable: true },
                    {
                        name: 'channelFeaturedAsset',
                        type: 'relation',
                        entity: Asset,
                        channelScoped: true,
                        nullable: true,
                    },
                    { name: 'globalNote', type: 'string', nullable: true },
                ],
            },
        }),
    );

    let channelCId: string;

    function asChannel(token: string) {
        adminClient.setChannelToken(token);
        shopClient.setChannelToken(token);
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const [code, token] of [
            ['cf-channel-b', CHANNEL_B_TOKEN],
            ['cf-channel-c', CHANNEL_C_TOKEN],
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
            if (code === 'cf-channel-c') {
                channelCId = createChannel.id;
            }
        }
        await adminClient.query(ASSIGN_PRODUCTS, { input: { channelId: 'T_2', productIds: ['T_1', 'T_2'] } });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('stores channel-scoped fields on the assignment row, not the entity', async () => {
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const columns = (table: string) => dataSource.getMetadata(table).columns.map(c => c.databaseName);
        expect(columns('Product')).toContain('customFieldsGlobalnote');
        expect(columns('Product')).not.toContain('customFieldsChannelnote');
        expect(columns('ProductChannel')).toEqual(
            expect.arrayContaining(['customFieldsChannelnote', 'customFieldsChannelfeaturedassetid']),
        );
        // Entities without channel-scoped fields get no customFields columns on their row
        expect(columns('FacetChannel').some(c => c.startsWith('customFields'))).toBe(false);
    });

    it('values are null by default in every channel', async () => {
        for (const token of [E2E_DEFAULT_CHANNEL_TOKEN, CHANNEL_B_TOKEN]) {
            asChannel(token);
            const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
            expect(product.customFields).toEqual({
                channelNote: null,
                globalNote: null,
                channelFeaturedAsset: null,
            });
        }
    });

    it('writes in one channel do not affect another; ordinary fields stay global', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { updateProduct } = await adminClient.query(UPDATE_PRODUCT, {
            input: {
                id: 'T_1',
                customFields: { channelNote: 'default note', globalNote: 'shared', channelFeaturedAssetId: 'T_1' },
            },
        });
        expect(updateProduct.customFields).toEqual({
            channelNote: 'default note',
            globalNote: 'shared',
            channelFeaturedAsset: { id: 'T_1' },
        });

        asChannel(CHANNEL_B_TOKEN);
        const { product: beforeB } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
        expect(beforeB.customFields).toEqual({
            channelNote: null,
            globalNote: 'shared',
            channelFeaturedAsset: null,
        });

        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { channelNote: 'B note', channelFeaturedAssetId: 'T_2' } },
        });
        const { product: inB } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
        expect(inB.customFields).toEqual({
            channelNote: 'B note',
            globalNote: 'shared',
            channelFeaturedAsset: { id: 'T_2' },
        });

        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product: inDefault } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
        expect(inDefault.customFields).toEqual({
            channelNote: 'default note',
            globalNote: 'shared',
            channelFeaturedAsset: { id: 'T_1' },
        });
    });

    it('null clears a channel-scoped value in the active channel only', async () => {
        asChannel(CHANNEL_B_TOKEN);
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_1', customFields: { channelFeaturedAssetId: null } },
        });
        const { product: inB } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
        expect(inB.customFields.channelFeaturedAsset).toBeNull();
        expect(inB.customFields.channelNote).toBe('B note');

        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product: inDefault } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
        expect(inDefault.customFields.channelFeaturedAsset).toEqual({ id: 'T_1' });
    });

    it('the Shop API reads the value of the active channel', async () => {
        asChannel(CHANNEL_B_TOKEN);
        const { product: inB } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
        expect(inB.customFields).toEqual({ channelNote: 'B note', globalNote: 'shared' });
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product: inDefault } = await shopClient.query(SHOP_PRODUCT, { id: 'T_1' });
        expect(inDefault.customFields).toEqual({ channelNote: 'default note', globalNote: 'shared' });
    });

    it('lists read per-channel values for every item', async () => {
        asChannel(CHANNEL_B_TOKEN);
        await adminClient.query(UPDATE_PRODUCT, { input: { id: 'T_2', customFields: { channelNote: 'B note 2' } } });
        const { products } = await adminClient.query(ADMIN_PRODUCTS, {});
        expect(products.items.map((p: any) => [p.id, p.customFields.channelNote])).toEqual([
            ['T_1', 'B note'],
            ['T_2', 'B note 2'],
        ]);
    });

    it('list filter and sort use the active channel value', async () => {
        asChannel(CHANNEL_B_TOKEN);
        const { products: filtered } = await adminClient.query(ADMIN_PRODUCTS, {
            options: { filter: { channelNote: { eq: 'B note' } } },
        });
        expect(filtered.items.map((p: any) => p.id)).toEqual(['T_1']);
        const { products: sorted } = await adminClient.query(ADMIN_PRODUCTS, {
            options: { sort: { channelNote: 'DESC' } },
        });
        expect(sorted.items.map((p: any) => p.id)).toEqual(['T_2', 'T_1']);

        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { products: inDefault } = await adminClient.query(ADMIN_PRODUCTS, {
            options: { filter: { channelNote: { eq: 'B note' } } },
        });
        expect(inDefault.totalItems).toBe(0);
    });

    it('assigning to a new channel copies the values from the active channel, including relations', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(ASSIGN_PRODUCTS, { input: { channelId: channelCId, productIds: ['T_1'] } });
        asChannel(CHANNEL_C_TOKEN);
        const { product } = await adminClient.query(ADMIN_PRODUCT, { id: 'T_1' });
        expect(product.customFields).toEqual({
            channelNote: 'default note',
            globalNote: 'shared',
            channelFeaturedAsset: { id: 'T_1' },
        });
    });

    it('createProduct writes channel-scoped values to the active channel only', async () => {
        asChannel(CHANNEL_B_TOKEN);
        const { createProduct } = await adminClient.query(
            gql`
                mutation CreateProduct($input: CreateProductInput!) {
                    createProduct(input: $input) {
                        ${PRODUCT_FIELDS}
                    }
                }
            `,
            {
                input: {
                    translations: [{ languageCode: LanguageCode.en, name: 'CF', slug: 'cf', description: '' }],
                    customFields: { channelNote: 'created in B', globalNote: 'g' },
                },
            },
        );
        expect(createProduct.customFields.channelNote).toBe('created in B');
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product } = await adminClient.query(ADMIN_PRODUCT, { id: createProduct.id });
        expect(product.customFields).toEqual({ channelNote: null, globalNote: 'g', channelFeaturedAsset: null });
    });
});
