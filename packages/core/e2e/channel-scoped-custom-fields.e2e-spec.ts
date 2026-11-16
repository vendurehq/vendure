/**
 * Channel-scoped custom fields (#490).
 *
 * A custom field with `scope: 'channel'` is stored on the entity's channel assignment row
 * (e.g. `ProductChannel`), and the normal `customFields` API reads and writes the value of the
 * active Channel. The tests run in order and share the state they set up.
 */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    Asset,
    ChannelAssignmentService,
    CollectionService,
    DefaultEncryptionStrategy,
    EntityHydrator,
    FastImporterService,
    Job,
    mergeConfig,
    Order,
    Product,
    ProductService,
    ProductVariantService,
    Promotion,
    RequestContext,
    RequestContextService,
    StockLocationService,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { In } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

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
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
            customFields: {
                Product: [
                    { name: 'channelNote', type: 'string', scope: 'channel', nullable: true },
                    {
                        name: 'channelFeaturedAsset',
                        type: 'relation',
                        entity: Asset,
                        scope: 'channel',
                        nullable: true,
                    },
                    { name: 'globalNote', type: 'string', nullable: true },
                    { name: 'channelPriority', type: 'int', scope: 'channel', defaultValue: 5 },
                    { name: 'channelTags', type: 'string', list: true, scope: 'channel', nullable: true },
                    { name: 'channelSku', type: 'string', unique: true, scope: 'channel', nullable: true },
                    {
                        name: 'channelApiKey',
                        type: 'string',
                        secret: true,
                        scope: 'channel',
                        nullable: true,
                    },
                    {
                        name: 'channelSpecs',
                        type: 'struct',
                        scope: 'channel',
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
                        scope: 'channel',
                        nullable: true,
                    },
                ],
                // The junction table of a list relation on an assignment entity has a long name:
                // product_variant_channels_channel_custom_fields_channel_gallery_asset (68 chars)
                ProductVariant: [
                    { name: 'channelBarcode', type: 'string', scope: 'channel', nullable: true },
                    {
                        name: 'channelGallery',
                        type: 'relation',
                        entity: Asset,
                        list: true,
                        scope: 'channel',
                        nullable: true,
                    },
                ],
                // Entities which OrderService locks, and which CollectionService queries with GROUP BY
                Order: [{ name: 'channelLabel', type: 'string', scope: 'channel', nullable: true }],
                ShippingMethod: [{ name: 'carrierNote', type: 'string', scope: 'channel', nullable: true }],
                PaymentMethod: [{ name: 'methodNote', type: 'string', scope: 'channel', nullable: true }],
                Promotion: [{ name: 'channelLabel', type: 'string', scope: 'channel', nullable: true }],
                Collection: [{ name: 'channelLabel', type: 'string', scope: 'channel', nullable: true }],
                StockLocation: [{ name: 'channelLabel', type: 'string', scope: 'channel', nullable: true }],
                Customer: [{ name: 'channelNickname', type: 'string', scope: 'channel', nullable: true }],
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
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
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
        // Relation custom fields can only link to Assets of the active channel (#5794)
        for (const channelId of ['T_2', channelCId]) {
            await adminClient.query(
                gql`
                    mutation ($input: AssignAssetsToChannelInput!) {
                        assignAssetsToChannel(input: $input) {
                            id
                        }
                    }
                `,
                { input: { channelId, assetIds: ['T_1', 'T_2', 'T_3'] } },
            );
        }
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

    it('exposes the scope in the custom field config', async () => {
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
                                    scope
                                }
                            }
                        }
                        customFieldConfig {
                            Product {
                                ... on CustomField {
                                    name
                                    scope
                                }
                            }
                        }
                    }
                }
            }
        `);
        const expected = [
            { name: 'channelNote', scope: 'channel' },
            { name: 'channelFeaturedAsset', scope: 'channel' },
            { name: 'globalNote', scope: 'global' },
            { name: 'channelPriority', scope: 'channel' },
            { name: 'channelTags', scope: 'channel' },
            { name: 'channelSku', scope: 'channel' },
            { name: 'channelApiKey', scope: 'channel' },
            { name: 'channelSpecs', scope: 'channel' },
            { name: 'channelGallery', scope: 'channel' },
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
        const values: any = await product!.getChannelCustomFields(ctxB, {
            relations: ['channelGallery'] as any,
        });
        expect(values?.channelGallery.map((a: any) => a.id)).toEqual([3]);

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
        // A list relation is copied too
        await adminClient.query(UPDATE_PRODUCT_LIST_FIELDS, {
            input: { id: 'T_1', customFields: { channelGalleryIds: ['T_1', 'T_2'] } },
        });
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
                        channelGallery {
                            id
                        }
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
            channelGallery: [{ id: 'T_1' }, { id: 'T_2' }],
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
            relations: ['channelFeaturedAsset'] as any,
        });
        expect((withAsset as any)?.channelFeaturedAsset).toEqual(expect.objectContaining({ id: 1 }));
        await expect(
            // The type only accepts relation fields; this checks the error for untyped callers
            inDefault!.getChannelCustomFields(ctxDefault, { relations: ['channelNote'] as any }),
        ).rejects.toThrow('is not a channel-scoped relation custom field');

        // Not assigned to channel B
        const notInB = await productService.findOne(ctxDefault, 3);
        expect(await notInB!.getChannelCustomFields(ctxB)).toBeUndefined();

        const getAssignments = vi.spyOn(server.app.get(ChannelAssignmentService), 'getAssignments');
        try {
            // Loaded with a RequestContext, the rows of that channel are joined, so no query
            const products = await productService.findByIds(ctxB, [1, 2]);
            getAssignments.mockClear();
            const values = await Promise.all(products.map(p => p.getChannelCustomFields(ctxB)));
            const notesById = Object.fromEntries(
                products.map((p, i) => [p.id, (values[i] as any)?.channelNote]),
            );
            expect(notesById).toEqual({ 1: 'B note', 2: 'B note 2' });
            expect(getAssignments).toHaveBeenCalledTimes(0);

            // Otherwise, reads made in the same tick share one query
            const raw = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(Product)
                .findBy({ id: In([1, 2]) });
            const rawValues = await Promise.all(raw.map(p => p.getChannelCustomFields(ctxB)));
            expect(rawValues.map((v: any) => v?.channelNote).sort()).toEqual(['B note', 'B note 2']);
            expect(getAssignments).toHaveBeenCalledTimes(1);
        } finally {
            getAssignments.mockRestore();
        }
    });

    it('entity.customFields holds the values of the ctx channel when loaded with a RequestContext', async () => {
        const requestContextService = server.app.get(RequestContextService);
        const productService = server.app.get(ProductService);
        const ctxDefault = await requestContextService.create({ apiType: 'admin' });
        const ctxB = await requestContextService.create({
            apiType: 'admin',
            channelOrToken: CHANNEL_B_TOKEN,
        });

        const inDefault: any = await productService.findOne(ctxDefault, 1);
        expect(inDefault.customFields.channelNote).toBe('default note');
        expect(inDefault.customFields.channelFeaturedAssetId).toBe(1);
        expect(inDefault.customFields.globalNote).toBe('shared');
        const inB: any = await productService.findOne(ctxB, 1);
        expect(inB.customFields.channelNote).toBe('B note');

        // Lists
        const { items } = await productService.findAll(ctxB, {});
        expect((items.find(p => p.id === 2) as any).customFields.channelNote).toBe('B note 2');
        // Entities of loaded relations
        const variant: any = await server.app.get(ProductVariantService).findOne(ctxB, 1, ['product']);
        expect(variant.product.customFields.channelNote).toBe('B note');
        // Repositories and QueryBuilders of the TransactionalConnection
        const connection = server.app.get(TransactionalConnection);
        const fromQb: any = await connection
            .getRepository(ctxB, Product)
            .createQueryBuilder('product')
            .where('product.id = :id', { id: 1 })
            .getOne();
        expect(fromQb.customFields.channelNote).toBe('B note');
        // Not assigned to the channel
        const notInB: any = await connection.getRepository(ctxB, Product).findOne({ where: { id: 3 } });
        expect(notInB.customFields.channelNote).toBeNull();

        // Without a RequestContext the value is not loaded, so reading it throws
        const raw: any = await connection.rawConnection.getRepository(Product).findOne({ where: { id: 1 } });
        expect(() => raw.customFields.channelNote).toThrow(
            '"channelNote" is a channel-scoped custom field of Product, whose value is only set on entities ' +
                'loaded with a RequestContext',
        );
        expect(() => raw.customFields.channelFeaturedAssetId).toThrow('"channelFeaturedAssetId"');
        expect(Object.keys(raw.customFields)).not.toContain('channelNote');
    });

    it('saving an entity with the TransactionalConnection writes its changed values to the ctx channel', async () => {
        const requestContextService = server.app.get(RequestContextService);
        const ctxDefault = await requestContextService.create({ apiType: 'admin' });
        const ctxB = await requestContextService.create({
            apiType: 'admin',
            channelOrToken: CHANNEL_B_TOKEN,
        });
        const repo = server.app.get(TransactionalConnection).getRepository(ctxB, Product);
        const product: any = await repo.findOne({ where: { id: 1 } });
        product.customFields.channelNote = 'saved in B';
        // A single relation, by its id
        product.customFields.channelFeaturedAssetId = 2;
        await repo.save(product);

        const inB = await product.getChannelCustomFields(ctxB);
        expect(inB).toEqual(
            expect.objectContaining({ channelNote: 'saved in B', channelFeaturedAssetId: 2 }),
        );
        const inDefault = await product.getChannelCustomFields(ctxDefault);
        expect(inDefault).toEqual(
            expect.objectContaining({ channelNote: 'default note', channelFeaturedAssetId: 1 }),
        );

        // Saving it again without changes does not write the assignment row
        const service = server.app.get(ChannelAssignmentService);
        const getMetadata = vi.spyOn(service, 'getMetadataOrThrow');
        try {
            await repo.save(product);
            expect(getMetadata).not.toHaveBeenCalled();
        } finally {
            getMetadata.mockRestore();
        }

        // Restore the values of channel B for the other tests
        product.customFields.channelNote = 'B note';
        product.customFields.channelFeaturedAssetId = null;
        await repo.save(product);
        expect(await product.getChannelCustomFields(ctxB)).toEqual(
            expect.objectContaining({ channelNote: 'B note', channelFeaturedAssetId: null }),
        );
    });

    // Postgres rejects FOR UPDATE on the nullable side of an outer join, and needs the selected
    // columns in the GROUP BY, so such queries must not join the assignment row
    it('queries with a lock or a GROUP BY work for entities with channel-scoped fields', async () => {
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const connection = server.app.get(TransactionalConnection);

        // As CollectionService.getCollectionsByProductId(), which serves Product.collections
        const collections = await server.app.get(CollectionService).getCollectionsByProductId(ctx, 1, false);
        expect(Array.isArray(collections)).toBe(true);

        // As OrderService locks Promotions and Orders. Locks are not supported by sqljs.
        if (process.env.DB && process.env.DB !== 'sqljs') {
            await connection.withTransaction(ctx, async txCtx => {
                const promotions = await connection
                    .getRepository(txCtx, Promotion)
                    .createQueryBuilder('promotion')
                    .setLock('pessimistic_write')
                    .getMany();
                expect(Array.isArray(promotions)).toBe(true);
                const order = await connection
                    .getRepository(txCtx, Order)
                    .findOne({ where: { id: 1 }, lock: { mode: 'pessimistic_write' } });
                expect(order === null || (order.customFields as any).channelLabel === null).toBe(true);
            });
        }
    });

    it('findOne() keeps the contract of TypeORM', async () => {
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const repo = server.app.get(TransactionalConnection).getRepository(ctx, Product);
        await expect(repo.findOne({})).rejects.toThrow(
            'You must provide selection conditions in order to find a single row.',
        );
        const product = await repo.findOne({ where: { enabled: true }, relations: { variants: true } });
        expect(product).toBeDefined();
    });

    it('saving a plain object writes its channel-scoped values', async () => {
        const ctxB = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', channelOrToken: CHANNEL_B_TOKEN });
        const repo = server.app.get(TransactionalConnection).getRepository(ctxB, Product);
        await repo.save({ id: 1, customFields: { channelNote: 'plain object' } } as any);
        const product = await repo.findOne({ where: { id: 1 } });
        expect((product!.customFields as any).channelNote).toBe('plain object');
        await repo.save({ id: 1, customFields: { channelNote: 'B note' } } as any);
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
            // Relations as the Importer gives them: keyed by the field name
            customFields: {
                channelNote: 'imported',
                channelFeaturedAsset: { id: 1 },
                channelGallery: [{ id: 1 }, { id: 2 }],
            },
        } as any);
        const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const values = await server.app
            .get(ChannelAssignmentService)
            .getCustomFieldValues(ctx, 'Product', productId, ['channelNote']);
        expect(values).toEqual({ channelNote: 'imported' });
        const product = await server.app
            .get(TransactionalConnection)
            .getRepository(ctx, Product)
            .findOne({ where: { id: productId } });
        const withRelations: any = await product!.getChannelCustomFields(ctx, {
            relations: ['channelGallery'] as any,
        });
        expect((withRelations as any)?.channelFeaturedAssetId).toBe(1);
        expect(withRelations?.channelGallery?.map((a: any) => a.id).sort()).toEqual([1, 2]);
        expect(server.app.get(ChannelAssignmentService).getMetadata(Product)?.dataProperties).toContain(
            'customFields',
        );
    });

    // Regression tests from the review of #5749

    it('entities with channel-scoped fields can be put in job data', async () => {
        const ctxB = await server.app
            .get(RequestContextService)
            .create({ apiType: 'admin', channelOrToken: CHANNEL_B_TOKEN });
        const loaded = await server.app.get(ProductService).findOne(ctxB, 1);
        // Loaded without a RequestContext, so the channel-scoped names are getters which throw
        const raw = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Product)
            .findOne({ where: { id: 1 } });
        const job = new Job({ queueName: 'test', data: { loaded, raw } as any });
        expect((job.data as any).loaded.customFields.channelNote).toBe('B note');
        expect((job.data as any).raw.customFields).not.toHaveProperty('channelNote');
        expect((job.data as any).raw.customFields.globalNote).toBe('shared');
    });

    it('createCustomer for a Customer registered in another channel saves its channel-scoped values', async () => {
        const createCustomer = gql`
            mutation CreateCustomer($input: CreateCustomerInput!, $password: String) {
                createCustomer(input: $input, password: $password) {
                    ... on Customer {
                        id
                        customFields {
                            channelNickname
                        }
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `;
        const input = {
            emailAddress: 'registered@channel-scoped.test',
            firstName: 'Reg',
            lastName: 'Istered',
        };
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { createCustomer: inDefault } = await adminClient.query(createCustomer, {
            input: { ...input, customFields: { channelNickname: 'Dee' } },
            password: 'test',
        });
        expect(inDefault.customFields.channelNickname).toBe('Dee');

        asChannel(CHANNEL_B_TOKEN);
        const { createCustomer: inB } = await adminClient.query(createCustomer, {
            input: { ...input, customFields: { channelNickname: 'Bee' } },
        });
        expect(inB.id).toBe(inDefault.id);
        const { customers } = await adminClient.query(CUSTOMER_BY_EMAIL, {
            options: { filter: { emailAddress: { eq: input.emailAddress } } },
        });
        expect(customers.items[0].customFields.channelNickname).toBe('Bee');
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { customers: inDefaultAfter } = await adminClient.query(CUSTOMER_BY_EMAIL, {
            options: { filter: { emailAddress: { eq: input.emailAddress } } },
        });
        expect(inDefaultAfter.items[0].customFields.channelNickname).toBe('Dee');
    });

    it('setCustomerForOrder in another channel copies the values of an existing guest Customer', async () => {
        // guest@channel-scoped.test has channelNickname 'nick' in the default channel
        asChannel(CHANNEL_B_TOKEN);
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { productVariantId: 'T_1', quantity: 1 });
        const { setCustomerForOrder } = await shopClient.query(SET_CUSTOMER, {
            input: { emailAddress: 'guest@channel-scoped.test', firstName: 'Guest', lastName: 'Shopper' },
        });
        expect(setCustomerForOrder.customer.emailAddress).toBe('guest@channel-scoped.test');
        const { customers } = await adminClient.query(CUSTOMER_BY_EMAIL, {
            options: { filter: { emailAddress: { eq: 'guest@channel-scoped.test' } } },
        });
        expect(customers.items[0].customFields.channelNickname).toBe('nick');
    });

    it('modifyOrder saves channel-scoped Order fields', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_CUSTOMER, {
            input: { emailAddress: 'modify@channel-scoped.test', firstName: 'Mo', lastName: 'Dify' },
        });
        await proceedToArrangingPayment(shopClient);
        const order = await addPaymentToOrder(shopClient, testSuccessfulPaymentMethod);
        const { transitionOrderToState } = await adminClient.query(
            gql`
                mutation Transition($id: ID!) {
                    transitionOrderToState(id: $id, state: "Modifying") {
                        ... on Order {
                            state
                        }
                    }
                }
            `,
            { id: order.id },
        );
        expect(transitionOrderToState.state).toBe('Modifying');
        const { modifyOrder } = await adminClient.query(
            gql`
                mutation Modify($input: ModifyOrderInput!) {
                    modifyOrder(input: $input) {
                        ... on Order {
                            id
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { input: { orderId: order.id, dryRun: false, customFields: { channelLabel: 'AM' } } },
        );
        expect(modifyOrder.id).toBe(order.id);
        const { order: modified } = await adminClient.query(
            gql`
                query Order($id: ID!) {
                    order(id: $id) {
                        customFields {
                            channelLabel
                        }
                    }
                }
            `,
            { id: order.id },
        );
        expect(modified.customFields.channelLabel).toBe('AM');
    });

    it('shipping and payment method types of the Shop and Admin APIs resolve channel-scoped fields', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(
            gql`
                mutation ($input: UpdateShippingMethodInput!) {
                    updateShippingMethod(input: $input) {
                        id
                    }
                }
            `,
            { input: { id: 'T_1', translations: [], customFields: { carrierNote: 'carrier note' } } },
        );
        await adminClient.query(
            gql`
                mutation ($input: UpdatePaymentMethodInput!) {
                    updatePaymentMethod(input: $input) {
                        id
                    }
                }
            `,
            { input: { id: 'T_1', translations: [], customFields: { methodNote: 'method note' } } },
        );
        await shopClient.asAnonymousUser();
        await shopClient.query(ADD_ITEM, { productVariantId: 'T_1', quantity: 1 });
        const shop = await shopClient.query(gql`
            {
                activeShippingMethods {
                    id
                    customFields {
                        carrierNote
                    }
                }
                activePaymentMethods {
                    id
                    customFields {
                        methodNote
                    }
                }
                eligibleShippingMethods {
                    id
                    customFields {
                        carrierNote
                    }
                }
                eligiblePaymentMethods {
                    id
                    customFields {
                        methodNote
                    }
                }
            }
        `);
        const byId = (items: any[], id: string) => items.find(item => item.id === id).customFields;
        expect(byId(shop.activeShippingMethods, 'T_1')).toEqual({ carrierNote: 'carrier note' });
        expect(byId(shop.activePaymentMethods, 'T_1')).toEqual({ methodNote: 'method note' });
        expect(byId(shop.eligibleShippingMethods, 'T_1')).toEqual({ carrierNote: 'carrier note' });
        expect(byId(shop.eligiblePaymentMethods, 'T_1')).toEqual({ methodNote: 'method note' });

        // Admin ShippingMethodQuote
        const { createDraftOrder } = await adminClient.query(gql`
            mutation {
                createDraftOrder {
                    id
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($orderId: ID!) {
                    addItemToDraftOrder(orderId: $orderId, input: { productVariantId: "T_1", quantity: 1 }) {
                        ... on Order {
                            id
                        }
                    }
                }
            `,
            { orderId: createDraftOrder.id },
        );
        await adminClient.query(
            gql`
                mutation ($orderId: ID!) {
                    setDraftOrderShippingAddress(
                        orderId: $orderId
                        input: { streetLine1: "1 street", countryCode: "US" }
                    ) {
                        id
                    }
                }
            `,
            { orderId: createDraftOrder.id },
        );
        const { eligibleShippingMethodsForDraftOrder } = await adminClient.query(
            gql`
                query ($orderId: ID!) {
                    eligibleShippingMethodsForDraftOrder(orderId: $orderId) {
                        id
                        customFields {
                            carrierNote
                        }
                    }
                }
            `,
            { orderId: createDraftOrder.id },
        );
        expect(byId(eligibleShippingMethodsForDraftOrder, 'T_1')).toEqual({ carrierNote: 'carrier note' });
    });

    it('lists which are not scoped to a channel filter and sort by channel-scoped fields of the active channel', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        await adminClient.query(
            gql`
                mutation ($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            {
                input: [
                    { id: 'T_1', customFields: { channelBarcode: 'd' } },
                    { id: 'T_2', customFields: { channelBarcode: 'c' } },
                    { id: 'T_3', customFields: { channelBarcode: 'b' } },
                    { id: 'T_4', customFields: { channelBarcode: 'a' } },
                ],
            },
        );
        // Product.variantList is built without a channelId
        const variantList = gql`
            query ($options: ProductVariantListOptions) {
                product(id: "T_1") {
                    variantList(options: $options) {
                        items {
                            id
                        }
                    }
                }
            }
        `;
        const { product: sorted } = await adminClient.query(variantList, {
            options: { sort: { channelBarcode: 'ASC' } },
        });
        expect(sorted.variantList.items.map((v: any) => v.id)).toEqual(['T_4', 'T_3', 'T_2', 'T_1']);
        const { product: filtered } = await adminClient.query(variantList, {
            options: { filter: { channelBarcode: { eq: 'c' } } },
        });
        expect(filtered.variantList.items.map((v: any) => v.id)).toEqual(['T_2']);
        // Other channels have their own values: none in channel B
        asChannel(CHANNEL_B_TOKEN);
        const { product: inB } = await adminClient.query(variantList, {
            options: { filter: { channelBarcode: { eq: 'c' } } },
        });
        expect(inB.variantList.items).toEqual([]);
    });

    it('lists filter and sort by a channel-scoped single relation', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const products = gql`
            query ($options: ProductListOptions) {
                products(options: $options) {
                    items {
                        id
                        customFields {
                            channelFeaturedAssetId
                        }
                    }
                }
            }
        `;
        const { products: filtered } = await adminClient.query(products, {
            options: { filter: { channelFeaturedAssetId: { eq: 'T_1' } } },
        });
        expect(filtered.items.map((p: any) => p.id)).toContain('T_1');
        expect(filtered.items.every((p: any) => p.customFields.channelFeaturedAssetId === 'T_1')).toBe(true);
        for (const sort of [{ channelFeaturedAssetId: 'DESC' }, { channelFeaturedAsset: 'DESC' }]) {
            const { products: sorted } = await adminClient.query(products, { options: { sort, take: 3 } });
            expect(sorted.items.length).toBeGreaterThan(0);
        }
    });

    it('customFields.<name>Id of a channel-scoped single relation resolves to the id', async () => {
        asChannel(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product } = await adminClient.query(gql`
            {
                product(id: "T_1") {
                    customFields {
                        channelFeaturedAsset {
                            id
                        }
                        channelFeaturedAssetId
                    }
                }
            }
        `);
        expect(product.customFields).toEqual({
            channelFeaturedAsset: { id: 'T_1' },
            channelFeaturedAssetId: 'T_1',
        });
    });

    it('reads and writes without a channel throw an error', async () => {
        const product = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Product)
            .findOne({ where: { id: 1 } });
        await expect(product!.getChannelCustomFields(RequestContext.empty())).rejects.toThrow(
            'Channel-scoped custom fields are read and written for a Channel, but the RequestContext has none',
        );
        await expect(
            server.app
                .get(ChannelAssignmentService)
                .updateCustomFields(RequestContext.empty(), Product, 1, undefined as any, {
                    channelNote: 'x',
                }),
        ).rejects.toThrow('Channel-scoped custom fields are read and written for a Channel');
    });

    // #5793 — unknown ids in relation input are rejected, also for channel-scoped relations
    it('rejects an unknown id in channel-scoped relation input', async () => {
        asChannel(CHANNEL_B_TOKEN);
        await expect(
            adminClient.query(UPDATE_PRODUCT, {
                input: { id: 'T_1', customFields: { channelFeaturedAssetId: 'T_999' } },
            }),
        ).rejects.toThrow('No Asset with the id "999" could be found');
        await expect(
            adminClient.query(UPDATE_PRODUCT_LIST_FIELDS, {
                input: { id: 'T_1', customFields: { channelGalleryIds: ['T_1', 'T_999'] } },
            }),
        ).rejects.toThrow('No Asset with the id "999" could be found');
    });
});
