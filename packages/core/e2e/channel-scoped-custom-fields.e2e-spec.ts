/**
 * Channel-scoped custom fields (#490).
 *
 * A custom field with `channelScoped: true` is stored on the entity's channel assignment row
 * (e.g. `ProductChannel`), and the normal `customFields` API reads and writes the value of the
 * active Channel. The tests run in order and share the state they set up.
 */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    Asset,
    ChannelAssignmentService,
    DefaultEncryptionStrategy,
    EntityHydrator,
    FastImporterService,
    mergeConfig,
    Product,
    ProductService,
    ProductVariantService,
    RequestContextService,
    StockLocationService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomProductChannelFields {
        channelNote: string | null;
        channelFeaturedAsset: Asset | null;
        channelPriority: number;
        channelTags: string[] | null;
        channelSku: string | null;
        channelApiKey: string | null;
        channelSpecs: { label: string; rank: number } | null;
        channelGallery: Asset[];
    }
    interface CustomStockLocationChannelFields {
        channelLabel: string | null;
    }
}

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

const PRODUCT_PRIORITY = gql`
    query ProductPriority($id: ID!) {
        product(id: $id) {
            customFields {
                channelPriority
            }
        }
    }
`;

const LIST_FIELDS = `
    id
    customFields {
        channelTags
        channelSpecs {
            label
            rank
        }
        channelGallery {
            id
        }
    }
`;

const PRODUCT_LIST_FIELDS = gql`
    query ProductListFields($id: ID!) {
        product(id: $id) {
            ${LIST_FIELDS}
        }
    }
`;

const UPDATE_PRODUCT_LIST_FIELDS = gql`
    mutation UpdateProductListFields($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            ${LIST_FIELDS}
        }
    }
`;

const REMOVE_PRODUCTS = gql`
    mutation RemoveProducts($input: RemoveProductsFromChannelInput!) {
        removeProductsFromChannel(input: $input) {
            id
        }
    }
`;

const CREATE_STOCK_LOCATION = gql`
    mutation CreateStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            id
            customFields {
                channelLabel
            }
        }
    }
`;

const UPDATE_STOCK_LOCATION = gql`
    mutation UpdateStockLocation($input: UpdateStockLocationInput!) {
        updateStockLocation(input: $input) {
            id
            customFields {
                channelLabel
            }
        }
    }
`;

const ADD_ITEM = gql`
    mutation AddItem($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ... on Order {
                id
            }
        }
    }
`;

const SET_CUSTOMER = gql`
    mutation SetCustomer($input: CreateCustomerInput!) {
        setCustomerForOrder(input: $input) {
            ... on Order {
                customer {
                    emailAddress
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const CUSTOMER_BY_EMAIL = gql`
    query CustomerByEmail($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                customFields {
                    channelNickname
                }
            }
        }
    }
`;

describe('Channel-scoped custom fields (#490)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            systemOptions: {
                encryptionStrategy: new DefaultEncryptionStrategy({ secret: 'channel-scoped-test-key' }),
            },
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
                    { name: 'channelPriority', type: 'int', channelScoped: true, defaultValue: 5 },
                    { name: 'channelTags', type: 'string', list: true, channelScoped: true, nullable: true },
                    { name: 'channelSku', type: 'string', unique: true, channelScoped: true, nullable: true },
                    {
                        name: 'channelApiKey',
                        type: 'string',
                        secret: true,
                        channelScoped: true,
                        nullable: true,
                    },
                    {
                        name: 'channelSpecs',
                        type: 'struct',
                        channelScoped: true,
                        fields: [
                            { name: 'label', type: 'string' },
                            { name: 'rank', type: 'int' },
                        ],
                    },
                    {
                        name: 'channelGallery',
                        type: 'relation',
                        entity: Asset,
                        list: true,
                        channelScoped: true,
                        nullable: true,
                    },
                ],
                // The junction table of a list relation on an assignment entity has a long name:
                // product_variant_channels_channel_custom_fields_channel_gallery_asset (68 chars)
                ProductVariant: [
                    {
                        name: 'channelGallery',
                        type: 'relation',
                        entity: Asset,
                        list: true,
                        channelScoped: true,
                        nullable: true,
                    },
                ],
                StockLocation: [
                    { name: 'channelLabel', type: 'string', channelScoped: true, nullable: true },
                ],
                Customer: [{ name: 'channelNickname', type: 'string', channelScoped: true, nullable: true }],
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

    it('exposes channelScoped in the custom field config', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { globalSettings } = await adminClient.query(gql`
            query {
                globalSettings {
                    serverConfig {
                        entityCustomFields {
                            entityName
                            customFields {
                                ... on CustomField {
                                    name
                                    channelScoped
                                }
                            }
                        }
                        customFieldConfig {
                            Product {
                                ... on CustomField {
                                    name
                                    channelScoped
                                }
                            }
                        }
                    }
                }
            }
        `);
        const expected = [
            { name: 'channelNote', channelScoped: true },
            { name: 'channelFeaturedAsset', channelScoped: true },
            { name: 'globalNote', channelScoped: false },
            { name: 'channelPriority', channelScoped: true },
            { name: 'channelTags', channelScoped: true },
            { name: 'channelSku', channelScoped: true },
            { name: 'channelApiKey', channelScoped: true },
            { name: 'channelSpecs', channelScoped: true },
            { name: 'channelGallery', channelScoped: true },
        ];
        const { entityCustomFields, customFieldConfig } = globalSettings.serverConfig;
        expect(entityCustomFields.find((e: any) => e.entityName === 'Product').customFields).toEqual(
            expected,
        );
        expect(customFieldConfig.Product).toEqual(expected);
    });

    it('schema sync finds no difference between the entities and the database', async () => {
        // On MySQL/MariaDB a varchar column on an assignment row used to be rebuilt on every sync
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const { upQueries } = await dataSource.driver.createSchemaBuilder().log();
        expect(upQueries.map(q => q.query)).toEqual([]);
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
                customFields: {
                    channelNote: 'default note',
                    globalNote: 'shared',
                    channelFeaturedAssetId: 'T_1',
                },
            },
        });
        expect(updateProduct.customFields).toEqual({
            channelNote: 'default note',
            globalNote: 'shared',
            channelFeaturedAsset: { id: 'T_1' },
        });

        // Stored on the default channel's ProductChannel row
        const row = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository('ProductChannel')
            .findOneByOrFail({ productId: 1, channelId: 1 });
        expect(row.customFields.channelNote).toBe('default note');

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
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_2', customFields: { channelNote: 'B note 2' } },
        });
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

    it('list fields, struct fields and list relations hold a value per channel', async () => {
        const read = async (token: string) => {
            asChannel(token);
            return (await adminClient.query(PRODUCT_LIST_FIELDS, { id: 'T_2' })).product.customFields;
        };
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(UPDATE_PRODUCT_LIST_FIELDS, {
            input: {
                id: 'T_2',
                customFields: {
                    channelTags: ['a', 'b'],
                    channelSpecs: { label: 'default', rank: 1 },
                    channelGalleryIds: ['T_1', 'T_2'],
                },
            },
        });
        asChannel(CHANNEL_B_TOKEN);
        await adminClient.query(UPDATE_PRODUCT_LIST_FIELDS, {
            input: {
                id: 'T_2',
                customFields: {
                    channelTags: ['b only'],
                    channelSpecs: { label: 'B', rank: 2 },
                    channelGalleryIds: ['T_3'],
                },
            },
        });

        const inDefault = {
            channelTags: ['a', 'b'],
            channelSpecs: { label: 'default', rank: 1 },
            channelGallery: [{ id: 'T_1' }, { id: 'T_2' }],
        };
        expect(await read(E2E_DEFAULT_CHANNEL_TOKEN)).toEqual(inDefault);
        expect(await read(CHANNEL_B_TOKEN)).toEqual({
            channelTags: ['b only'],
            channelSpecs: { label: 'B', rank: 2 },
            channelGallery: [{ id: 'T_3' }],
        });

        const ctxB = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', channelOrToken: CHANNEL_B_TOKEN });
        const product = await server.app.get(ProductService).findOne(ctxB, 2);
        const values = await product!.getChannelCustomFields(ctxB, { relations: ['channelGallery'] });
        expect(values?.channelGallery.map(a => a.id)).toEqual([3]);

        // The same on ProductVariant, whose junction table name is too long for Postgres and MySQL,
        // so TypeORM shortens it
        const variantGallery = gql`
            query VariantGallery($id: ID!) {
                productVariant(id: $id) {
                    customFields {
                        channelGallery {
                            id
                        }
                    }
                }
            }
        `;
        asChannel(CHANNEL_B_TOKEN);
        await adminClient.query(
            gql`
                mutation UpdateVariantGallery($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: [{ id: 'T_1', customFields: { channelGalleryIds: ['T_2', 'T_3'] } }] },
        );
        const { productVariant: variantInB } = await adminClient.query(variantGallery, { id: 'T_1' });
        expect(variantInB.customFields.channelGallery).toEqual([{ id: 'T_2' }, { id: 'T_3' }]);
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { productVariant: variantInDefault } = await adminClient.query(variantGallery, { id: 'T_1' });
        expect(variantInDefault.customFields.channelGallery).toEqual([]);

        // Assigning to a new channel copies them, including the list relation
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(ASSIGN_PRODUCTS, { input: { channelId: channelCId, productIds: ['T_2'] } });
        expect(await read(CHANNEL_C_TOKEN)).toEqual(inDefault);

        // Removing it from the channel deletes the rows of the list relation's junction table too
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const junction = dataSource
            .getMetadata('ProductChannel')
            .findRelationWithPropertyPath('customFields.channelGallery')!.junctionEntityMetadata!;
        const channelColumn = junction.ownerColumns.find(
            c => c.referencedColumn?.propertyName === 'channelId',
        )!;
        const productColumn = junction.ownerColumns.find(
            c => c.referencedColumn?.propertyName === 'productId',
        )!;
        const galleryRowsInC = () =>
            dataSource
                .createQueryBuilder()
                .select('*')
                .from(junction.tableName, 'j')
                .where(`j.${dataSource.driver.escape(channelColumn.databaseName)} = :channelId`, {
                    channelId: Number(channelCId.replace('T_', '')),
                })
                .andWhere(`j.${dataSource.driver.escape(productColumn.databaseName)} = :productId`, {
                    productId: 2,
                })
                .getRawMany();
        expect(await galleryRowsInC()).toHaveLength(2);
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(REMOVE_PRODUCTS, { input: { channelId: channelCId, productIds: ['T_2'] } });
        expect(await galleryRowsInC()).toEqual([]);
    });

    it('a unique field is unique within each channel', async () => {
        const setSku = (id: string, sku: string) =>
            adminClient.query(
                gql`
                    mutation SetSku($input: UpdateProductInput!) {
                        updateProduct(input: $input) {
                            id
                        }
                    }
                `,
                { input: { id, customFields: { channelSku: sku } } },
            );
        // The error of the unique index, on each database
        const uniqueViolation = /UNIQUE constraint failed|duplicate key value|Duplicate entry/;
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await setSku('T_1', 'SKU-1');
        await expect(setSku('T_2', 'SKU-1')).rejects.toThrow(uniqueViolation);
        // The same value in another channel
        asChannel(CHANNEL_B_TOKEN);
        await setSku('T_1', 'SKU-1');
        await expect(setSku('T_2', 'SKU-1')).rejects.toThrow(uniqueViolation);
        await setSku('T_2', 'SKU-2');

        // Assigning to a channel does not copy a unique value, which another product may use there:
        // T_1 is in channel C, and T_2 is assigned to it from the default channel
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await setSku('T_2', 'SKU-3');
        asChannel(CHANNEL_C_TOKEN);
        await setSku('T_1', 'SKU-3');
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(ASSIGN_PRODUCTS, { input: { channelId: channelCId, productIds: ['T_2'] } });
        asChannel(CHANNEL_C_TOKEN);
        const { product: copied } = await adminClient.query(
            gql`
                query CopiedSku($id: ID!) {
                    product(id: $id) {
                        customFields {
                            channelSku
                            channelTags
                        }
                    }
                }
            `,
            { id: 'T_2' },
        );
        // The other values are copied
        expect(copied.customFields).toEqual({ channelSku: null, channelTags: ['a', 'b'] });
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(REMOVE_PRODUCTS, { input: { channelId: channelCId, productIds: ['T_2'] } });

        const index = server.app
            .get(TransactionalConnection)
            .rawConnection.getMetadata('ProductChannel')
            .indices.find(i => i.columns.some(c => c.propertyPath === 'customFields.channelSku'));
        expect(index?.isUnique).toBe(true);
        expect(index?.columns.map(c => c.propertyPath)).toEqual(['channelId', 'customFields.channelSku']);
    });

    it('a secret field is encrypted on the row, redacted without ReadSecret, and kept on a placeholder', async () => {
        const query = gql`
            query ProductApiKey($id: ID!) {
                product(id: $id) {
                    customFields {
                        channelApiKey
                    }
                }
            }
        `;
        const setKey = (key: string) =>
            adminClient.query(
                gql`
                    mutation SetApiKey($input: UpdateProductInput!) {
                        updateProduct(input: $input) {
                            id
                        }
                    }
                `,
                { input: { id: 'T_1', customFields: { channelApiKey: key } } },
            );
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await setKey('key in default');
        asChannel(CHANNEL_B_TOKEN);
        await setKey('key in B');

        // The SuperAdmin has the ReadSecret permission
        expect((await adminClient.query(query, { id: 'T_1' })).product.customFields.channelApiKey).toBe(
            'key in B',
        );
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        expect((await adminClient.query(query, { id: 'T_1' })).product.customFields.channelApiKey).toBe(
            'key in default',
        );

        // Stored encrypted on the ProductChannel row
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const column = dataSource
            .getMetadata('ProductChannel')
            .findColumnWithPropertyPath('customFields.channelApiKey')!;
        const [row] = await dataSource
            .createQueryBuilder()
            .select(`pc.${dataSource.driver.escape(column.databaseName)}`, 'value')
            .from('product_channels_channel', 'pc')
            .where(
                `pc.${dataSource.driver.escape('productId')} = 1 AND pc.${dataSource.driver.escape('channelId')} = 1`,
            )
            .getRawMany();
        expect(row.value).toBeTruthy();
        expect(row.value).not.toContain('key in default');

        // The Shop API has no ReadSecret permission
        asChannel(CHANNEL_B_TOKEN);
        const { product: inShop } = await shopClient.query(query, { id: 'T_1' });
        expect(inShop.customFields.channelApiKey).toBe(REDACTED_SECRET_PLACEHOLDER);

        // Saving the placeholder back keeps the stored value of that channel
        await setKey(REDACTED_SECRET_PLACEHOLDER);
        expect((await adminClient.query(query, { id: 'T_1' })).product.customFields.channelApiKey).toBe(
            'key in B',
        );
    });

    it('duplicating an entity copies its channel-scoped values in the active channel, except unique ones', async () => {
        asChannel(CHANNEL_B_TOKEN);
        const { duplicateEntity } = await adminClient.query(
            gql`
                mutation Duplicate($input: DuplicateEntityInput!) {
                    duplicateEntity(input: $input) {
                        ... on DuplicateEntitySuccess {
                            newEntityId
                        }
                        ... on DuplicateEntityError {
                            message
                            duplicationError
                        }
                    }
                }
            `,
            {
                input: {
                    entityName: 'Product',
                    entityId: 'T_1',
                    duplicatorInput: {
                        code: 'product-duplicator',
                        arguments: [{ name: 'includeVariants', value: 'false' }],
                    },
                },
            },
        );
        expect(duplicateEntity.newEntityId).toBeDefined();
        const read = gql`
            query Copy($id: ID!) {
                product(id: $id) {
                    customFields {
                        channelNote
                        channelPriority
                        channelSku
                        channelApiKey
                        globalNote
                    }
                }
            }
        `;
        const { product: copy } = await adminClient.query(read, { id: duplicateEntity.newEntityId });
        expect(copy.customFields).toEqual({
            channelNote: 'B note',
            channelPriority: 5,
            // unique within the channel, so it is not copied
            channelSku: null,
            channelApiKey: 'key in B',
            globalNote: 'shared',
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
                    translations: [
                        { languageCode: LanguageCode.en, name: 'CF', slug: 'cf', description: '' },
                    ],
                    customFields: { channelNote: 'created in B', globalNote: 'g' },
                },
            },
        );
        expect(createProduct.customFields.channelNote).toBe('created in B');
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product } = await adminClient.query(ADMIN_PRODUCT, { id: createProduct.id });
        expect(product.customFields).toEqual({
            channelNote: null,
            globalNote: 'g',
            channelFeaturedAsset: null,
        });
    });

    it('a defaultValue is the initial value in each channel, with no fallback between channels', async () => {
        const priority = async (token: string, id: string) => {
            asChannel(token);
            const { product } = await adminClient.query(PRODUCT_PRIORITY, { id });
            return product.customFields.channelPriority;
        };
        // Assignment rows which existed before any write get the column default
        expect(await priority(E2E_DEFAULT_CHANNEL_TOKEN, 'T_2')).toBe(5);
        expect(await priority(CHANNEL_B_TOKEN, 'T_2')).toBe(5);

        asChannel(CHANNEL_B_TOKEN);
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_2', customFields: { channelPriority: 9 } },
        });
        expect(await priority(CHANNEL_B_TOKEN, 'T_2')).toBe(9);
        expect(await priority(E2E_DEFAULT_CHANNEL_TOKEN, 'T_2')).toBe(5);

        // A new entity gets the default in every channel it is created in
        asChannel(CHANNEL_B_TOKEN);
        const { createProduct } = await adminClient.query(
            gql`
                mutation CreateProduct($input: CreateProductInput!) {
                    createProduct(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Prio', slug: 'prio', description: '' },
                    ],
                },
            },
        );
        expect(await priority(CHANNEL_B_TOKEN, createProduct.id)).toBe(5);
        expect(await priority(E2E_DEFAULT_CHANNEL_TOKEN, createProduct.id)).toBe(5);
    });

    it('product.getChannelCustomFields(ctx) reads the values of the ctx channel', async () => {
        const requestContextService = server.app.get(RequestContextService);
        const productService = server.app.get(ProductService);
        const ctxDefault = await requestContextService.create({ apiType: 'admin' });
        const ctxB = await requestContextService.create({
            apiType: 'admin',
            channelOrToken: CHANNEL_B_TOKEN,
        });

        // A translated entity from a service, as plugin code would get it
        const inDefault = await productService.findOne(ctxDefault, 1);
        // Like ordinary relation custom fields, the foreign key is exposed as `<name>Id`
        expect(await inDefault!.getChannelCustomFields(ctxDefault)).toEqual({
            channelNote: 'default note',
            channelPriority: 5,
            channelFeaturedAssetId: 1,
            channelTags: null,
            channelSku: 'SKU-1',
            // Decrypted: getChannelCustomFields() is for server-side code, like entity.customFields
            channelApiKey: 'key in default',
            channelSpecs: null,
        });
        expect(await inDefault!.getChannelCustomFields(ctxB)).toEqual({
            channelNote: 'B note',
            channelPriority: 5,
            channelFeaturedAssetId: null,
            channelTags: null,
            channelSku: 'SKU-1',
            channelApiKey: 'key in B',
            channelSpecs: null,
        });
        expect(await inDefault!.getChannelCustomFields(ctxDefault, { channelId: ctxB.channelId })).toEqual({
            channelNote: 'B note',
            channelPriority: 5,
            channelFeaturedAssetId: null,
            channelTags: null,
            channelSku: 'SKU-1',
            channelApiKey: 'key in B',
            channelSpecs: null,
        });

        // Relation fields on request
        const withAsset = await inDefault!.getChannelCustomFields(ctxDefault, {
            relations: ['channelFeaturedAsset'],
        });
        expect(withAsset?.channelFeaturedAsset).toEqual(expect.objectContaining({ id: 1 }));
        await expect(
            // The type only accepts relation fields; this checks the error for untyped callers
            inDefault!.getChannelCustomFields(ctxDefault, { relations: ['channelNote'] as any }),
        ).rejects.toThrow('is not a channel-scoped relation custom field');

        // Not assigned to channel B
        const notInB = await productService.findOne(ctxDefault, 3);
        expect(await notInB!.getChannelCustomFields(ctxB)).toBeUndefined();

        // Reads made in the same tick share one query
        const products = await productService.findByIds(ctxB, [1, 2]);
        const getAssignments = vi.spyOn(server.app.get(ChannelAssignmentService), 'getAssignments');
        try {
            const values = await Promise.all(products.map(p => p.getChannelCustomFields(ctxB)));
            const notesById = Object.fromEntries(products.map((p, i) => [p.id, values[i]?.channelNote]));
            expect(notesById).toEqual({ 1: 'B note', 2: 'B note 2' });
            expect(getAssignments).toHaveBeenCalledTimes(1);
        } finally {
            getAssignments.mockRestore();
        }
    });

    it('reading a channel-scoped field from entity.customFields throws an error which says how to read it', async () => {
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const product: any = await server.app.get(ProductService).findOne(ctx, 1);
        const expected =
            '"channelNote" is a channel-scoped custom field of Product, so its value is not stored on the ' +
            'entity. Read it with product.getChannelCustomFields(ctx), and declare its type on ' +
            'CustomProductChannelFields.';
        expect(() => product.customFields.channelNote).toThrow(expected);
        // Also the id of a single relation
        expect(() => product.customFields.channelFeaturedAssetId).toThrow('"channelFeaturedAssetId"');
        // Ordinary custom fields, spreading and serialization are unaffected
        expect(product.customFields.globalNote).toBe('shared');
        expect(Object.keys(product.customFields)).not.toContain('channelNote');
        expect(JSON.parse(JSON.stringify(product.customFields))).toEqual({ ...product.customFields });
        // Writing still stores the value on the object
        product.customFields.channelNote = 'set in code';
        expect(product.customFields.channelNote).toBe('set in code');
    });

    it('reads null for an entity which is not assigned to the Channel', async () => {
        // T_3 is only in the default channel
        const ctxB = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', channelOrToken: CHANNEL_B_TOKEN });
        const values = await server.app
            .get(ChannelAssignmentService)
            .getCustomFieldValues(ctxB, 'Product', 3, ['channelNote']);
        expect(values).toEqual({ channelNote: null });
    });

    it('removing an entity from a Channel deletes its values there', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        // T_1 was assigned to channel C, copying its default channel values
        await adminClient.query(REMOVE_PRODUCTS, { input: { channelId: channelCId, productIds: ['T_1'] } });
        const rows = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository('ProductChannel')
            .findBy({ productId: 1, channelId: Number(channelCId.replace('T_', '')) });
        expect(rows).toEqual([]);
    });

    it('works for other ChannelAware entities: StockLocation create and update', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { createStockLocation } = await adminClient.query(CREATE_STOCK_LOCATION, {
            input: { name: 'Warehouse', customFields: { channelLabel: 'created' } },
        });
        expect(createStockLocation.customFields.channelLabel).toBe('created');
        const { updateStockLocation } = await adminClient.query(UPDATE_STOCK_LOCATION, {
            input: { id: createStockLocation.id, customFields: { channelLabel: 'updated' } },
        });
        expect(updateStockLocation.customFields.channelLabel).toBe('updated');

        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const stockLocation = await server.app
            .get(StockLocationService)
            .findOne(ctx, Number(createStockLocation.id.replace('T_', '')));
        expect(await stockLocation!.getChannelCustomFields(ctx)).toEqual({ channelLabel: 'updated' });
    });

    it('EntityHydrator rejects channel-scoped custom fields and points to getChannelCustomFields()', async () => {
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const hydrator = server.app.get(EntityHydrator);
        const product = await server.app.get(ProductService).findOne(ctx, 1);
        await expect(
            hydrator.hydrate(ctx, product!, { relations: ['customFields.channelFeaturedAsset'] }),
        ).rejects.toThrow(
            'Cannot hydrate "customFields.channelFeaturedAsset": "channelFeaturedAsset" is a channel-scoped ' +
                'custom field of Product',
        );
        // Also on a related entity
        const variant = await server.app.get(ProductVariantService).findOne(ctx, 1);
        await expect(
            hydrator.hydrate(ctx, variant!, { relations: ['product.customFields.channelFeaturedAsset'] }),
        ).rejects.toThrow(
            "getChannelCustomFields(ctx, { relations: ['channelFeaturedAsset'] }) on the Product",
        );
    });

    it('saves the values of a guest Customer created by setCustomerForOrder', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { productVariantId: 'T_1', quantity: 1 });
        const { setCustomerForOrder } = await shopClient.query(SET_CUSTOMER, {
            input: {
                emailAddress: 'guest@channel-scoped.test',
                firstName: 'Guest',
                lastName: 'Shopper',
                customFields: { channelNickname: 'nick' },
            },
        });
        expect(setCustomerForOrder.customer.emailAddress).toBe('guest@channel-scoped.test');
        const { customers } = await adminClient.query(CUSTOMER_BY_EMAIL, {
            options: { filter: { emailAddress: { eq: 'guest@channel-scoped.test' } } },
        });
        expect(customers.items[0].customFields.channelNickname).toBe('nick');
    });

    it('saves the values of a Product created by the FastImporterService', async () => {
        const importer = server.app.get(FastImporterService);
        await importer.initialize();
        const productId = await importer.createProduct({
            translations: [
                { languageCode: LanguageCode.en, name: 'Imported', slug: 'imported', description: '' },
            ],
            customFields: { channelNote: 'imported' },
        } as any);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const values = await server.app
            .get(ChannelAssignmentService)
            .getCustomFieldValues(ctx, 'Product', productId, ['channelNote']);
        expect(values).toEqual({ channelNote: 'imported' });
        expect(server.app.get(ChannelAssignmentService).getMetadata(Product)?.dataProperties).toContain(
            'customFields',
        );
    });
});
