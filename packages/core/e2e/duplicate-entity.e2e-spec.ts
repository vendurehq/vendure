/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { pick } from '@vendure/common/lib/pick';
import {
    Collection,
    CollectionService,
    CurrencyCode,
    defaultEntityDuplicators,
    EntityDuplicator,
    freeShipping,
    LanguageCode,
    mergeConfig,
    minimumOrderAmount,
    Permission,
    PermissionDefinition,
    TransactionalConnection,
    variantIdCollectionFilter,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment, promotionFragment, roleFragment } from './graphql/fragments-admin';
import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import {
    assignProductToChannelDocument,
    createAdministratorDocument,
    createChannelDocument,
    createCollectionDocument,
    createPromotionDocument,
    createRoleDocument,
    duplicateEntityDocument,
    getCollectionDocument,
    getCollectionsDocument,
    getEntityDuplicatorsDocument,
    getFacetWithValuesDocument,
    getProductWithVariantsDocument,
    getPromotionDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';

const customPermission = new PermissionDefinition({
    name: 'custom',
});

let collectionService: CollectionService;
let connection: TransactionalConnection;

const customCollectionDuplicator = new EntityDuplicator({
    code: 'custom-collection-duplicator',
    description: [{ languageCode: LanguageCode.en, value: 'Custom Collection Duplicator' }],
    args: {
        throwError: {
            type: 'boolean',
            defaultValue: false,
        },
    },
    forEntities: ['Collection'],
    requiresPermission: customPermission.Permission,
    init(injector) {
        collectionService = injector.get(CollectionService);
        connection = injector.get(TransactionalConnection);
    },
    duplicate: async input => {
        const { ctx, id, args } = input;

        const original = await connection.getEntityOrThrow(ctx, Collection, id, {
            relations: {
                assets: true,
                featuredAsset: true,
            },
        });
        const newCollection = await collectionService.create(ctx, {
            isPrivate: original.isPrivate,
            customFields: original.customFields,
            assetIds: original.assets.map(a => a.id),
            featuredAssetId: original.featuredAsset?.id,
            parentId: original.parentId,
            filters: original.filters.map(f => ({
                code: f.code,
                arguments: f.args,
            })),
            inheritFilters: original.inheritFilters,
            translations: original.translations.map(t => ({
                languageCode: t.languageCode,
                name: `${t.name} (copy)`,
                slug: `${t.slug}-copy`,
                description: t.description,
                customFields: t.customFields,
            })),
        });

        if (args.throwError) {
            throw new Error('Dummy error');
        }

        return newCollection;
    },
});

describe('Duplicating entities', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                customPermissions: [customPermission],
            },
            entityOptions: {
                entityDuplicators: [...defaultEntityDuplicators, customCollectionDuplicator],
            },
        }),
    );

    const duplicateEntityGuard: ErrorResultGuard<{ newEntityId: string }> = createErrorResultGuard(
        result => !!result.newEntityId,
    );

    const createChannelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
        result => !!result.id,
    );

    let testRole: FragmentOf<typeof roleFragment>;
    let testAdmin: ResultOf<typeof createAdministratorDocument>['createAdministrator'];
    let newEntityId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // create a new role and Admin and sign in as that Admin
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                channelIds: ['T_1'],
                code: 'test-role',
                description: 'Testing custom permissions',
                permissions: [
                    Permission.CreateCollection,
                    Permission.UpdateCollection,
                    Permission.ReadCollection,
                ],
            },
        });
        testRole = createRole;
        const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Test',
                lastName: 'Admin',
                emailAddress: 'test@admin.com',
                password: 'test',
                roleIds: [testRole.id],
            },
        });

        testAdmin = createAdministrator;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('get entity duplicators', async () => {
        const { entityDuplicators } = await adminClient.query(getEntityDuplicatorsDocument);

        expect(entityDuplicators.find(d => d.code === 'custom-collection-duplicator')).toEqual({
            args: [
                {
                    defaultValue: false,
                    name: 'throwError',
                    type: 'boolean',
                },
            ],
            code: 'custom-collection-duplicator',
            description: 'Custom Collection Duplicator',
            forEntities: ['Collection'],
            requiresPermission: ['custom'],
        });
    });

    it('cannot duplicate if lacking permissions', async () => {
        await adminClient.asUserWithCredentials(testAdmin.emailAddress, 'test');

        const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
            input: {
                entityName: 'Collection',
                entityId: 'T_2',
                duplicatorInput: {
                    code: 'custom-collection-duplicator',
                    arguments: [
                        {
                            name: 'throwError',
                            value: 'false',
                        },
                    ],
                },
            },
        });

        duplicateEntityGuard.assertErrorResult(duplicateEntity);

        expect(duplicateEntity.message).toBe('The entity could not be duplicated');
        expect(duplicateEntity.duplicationError).toBe(
            'You do not have the required permissions to duplicate this entity',
        );
    });

    it('errors thrown in duplicator cause ErrorResult', async () => {
        await adminClient.asSuperAdmin();

        const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
            input: {
                entityName: 'Collection',
                entityId: 'T_2',
                duplicatorInput: {
                    code: 'custom-collection-duplicator',
                    arguments: [
                        {
                            name: 'throwError',
                            value: 'true',
                        },
                    ],
                },
            },
        });

        duplicateEntityGuard.assertErrorResult(duplicateEntity);

        expect(duplicateEntity.message).toBe('The entity could not be duplicated');
        expect(duplicateEntity.duplicationError).toBe('Dummy error');
    });

    it('errors thrown cause all DB changes to be rolled back', async () => {
        await adminClient.asSuperAdmin();

        const { collections } = await adminClient.query(getCollectionsDocument);

        expect(collections.items.length).toBe(1);
        expect(collections.items.map(i => i.name)).toEqual(['Plants']);
    });

    it('returns ID of new entity', async () => {
        await adminClient.asSuperAdmin();

        const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
            input: {
                entityName: 'Collection',
                entityId: 'T_2',
                duplicatorInput: {
                    code: 'custom-collection-duplicator',
                    arguments: [
                        {
                            name: 'throwError',
                            value: 'false',
                        },
                    ],
                },
            },
        });

        duplicateEntityGuard.assertSuccess(duplicateEntity);

        expect(duplicateEntity.newEntityId).toBeDefined();
        newEntityId = duplicateEntity.newEntityId;
    });

    it('duplicate gets created', async () => {
        const { collection } = await adminClient.query(getCollectionDocument, {
            id: newEntityId,
        });

        expect(pick(collection!, ['id', 'name', 'slug'])).toEqual({
            id: newEntityId,
            name: 'Plants (copy)',
            slug: 'plants-copy',
        });
    });

    describe('default entity duplicators', () => {
        describe('Product duplicator', () => {
            let originalProduct: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;
            let originalFirstVariant: NonNullable<
                ResultOf<typeof getProductWithVariantsDocument>['product']
            >['variants'][0];
            let newProduct1Id: string;
            let newProduct2Id: string;

            beforeAll(async () => {
                await adminClient.asSuperAdmin();

                // Add asset and facet values to the first product variant
                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: 'T_1',
                            assetIds: ['T_1'],
                            featuredAssetId: 'T_1',
                            facetValueIds: ['T_1', 'T_2'],
                        },
                    ],
                });

                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: 'T_1',
                });
                originalProduct = product!;
                originalFirstVariant = product!.variants.find(v => v.id === 'T_1')!;
            });

            it('duplicate product without variants', async () => {
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Product',
                        entityId: 'T_1',
                        duplicatorInput: {
                            code: 'product-duplicator',
                            arguments: [
                                {
                                    name: 'includeVariants',
                                    value: 'false',
                                },
                            ],
                        },
                    },
                });

                duplicateEntityGuard.assertSuccess(duplicateEntity);

                newProduct1Id = duplicateEntity.newEntityId;

                expect(newProduct1Id).toBe('T_2');
            });

            it('new product has no variants', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct1Id,
                });

                expect(product?.variants.length).toBe(0);
            });

            it('is initially disabled', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct1Id,
                });

                expect(product?.enabled).toBe(false);
            });

            it('assets are duplicated', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct1Id,
                });

                expect(product?.featuredAsset).toEqual(originalProduct.featuredAsset);
                expect(product?.assets.length).toBe(1);
                expect(product?.assets).toEqual(originalProduct.assets);
            });

            it('facet values are duplicated', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct1Id,
                });

                expect(product?.facetValues).toEqual(originalProduct.facetValues);
                expect(product?.facetValues.map(fv => fv.name).sort()).toEqual(['computers', 'electronics']);
            });

            it('duplicate product with variants', async () => {
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Product',
                        entityId: 'T_1',
                        duplicatorInput: {
                            code: 'product-duplicator',
                            arguments: [
                                {
                                    name: 'includeVariants',
                                    value: 'true',
                                },
                            ],
                        },
                    },
                });

                duplicateEntityGuard.assertSuccess(duplicateEntity);

                newProduct2Id = duplicateEntity.newEntityId;

                expect(newProduct2Id).toBe('T_3');
            });

            it('new product has variants', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct2Id,
                });

                expect(product?.variants.length).toBe(4);
                expect(product?.variants.length).toBe(originalProduct.variants.length);

                expect(product?.variants.map(v => v.name).sort()).toEqual(
                    originalProduct.variants.map(v => v.name).sort(),
                );
            });

            it('product name is suffixed', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct2Id,
                });

                expect(product?.name).toBe('Laptop (copy)');
            });

            it('variant SKUs are suffixed', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct2Id,
                });

                expect(product?.variants.map(v => v.sku).sort()).toEqual([
                    'L2201308-copy',
                    'L2201316-copy',
                    'L2201508-copy',
                    'L2201516-copy',
                ]);
            });

            it('variant assets are preserved', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct2Id,
                });

                expect(product?.variants.find(v => v.name === originalFirstVariant.name)?.assets).toEqual(
                    originalFirstVariant.assets,
                );

                expect(
                    product?.variants.find(v => v.name === originalFirstVariant.name)?.featuredAsset,
                ).toEqual(originalFirstVariant.featuredAsset);
            });

            it('variant facet values are preserved', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct2Id,
                });

                expect(
                    product?.variants.find(v => v.name === originalFirstVariant.name)?.facetValues.length,
                ).toBe(2);

                expect(
                    product?.variants.find(v => v.name === originalFirstVariant.name)?.facetValues,
                ).toEqual(originalFirstVariant.facetValues);
            });

            it('variant stock levels are preserved', async () => {
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: newProduct2Id,
                });

                expect(product?.variants.find(v => v.name === originalFirstVariant.name)?.stockOnHand).toBe(
                    100,
                );
            });

            it('variant prices are duplicated', async () => {
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Product',
                        entityId: 'T_1',
                        duplicatorInput: {
                            code: 'product-duplicator',
                            arguments: [
                                {
                                    name: 'includeVariants',
                                    value: 'true',
                                },
                            ],
                        },
                    },
                });

                duplicateEntityGuard.assertSuccess(duplicateEntity);

                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: duplicateEntity.newEntityId,
                });
                const variant = product?.variants.find(v => v.sku.startsWith(originalFirstVariant.sku));
                expect(variant).not.toBeUndefined();
                expect(originalFirstVariant.price).toBeGreaterThan(0);
                expect(variant!.price).toBe(originalFirstVariant.price);
            });

            it('variant prices are duplicated on a channel specific basis', async () => {
                const { createChannel } = await adminClient.query(createChannelDocument, {
                    input: {
                        code: 'second-channel',
                        token: 'second-channel',
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: CurrencyCode.USD,
                        pricesIncludeTax: false,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                });
                createChannelGuard.assertSuccess(createChannel);

                await adminClient.query(assignProductToChannelDocument, {
                    input: {
                        channelId: createChannel.id,
                        productIds: ['T_1'],
                    },
                });

                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: 'T_1',
                });
                const productVariant = product!.variants[0];

                adminClient.setChannelToken('second-channel');

                await adminClient.query(updateProductVariantsDocument, {
                    input: [
                        {
                            id: productVariant.id,
                            price: productVariant.price + 150,
                        },
                    ],
                });

                adminClient.setChannelToken('e2e-default-channel');

                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Product',
                        entityId: 'T_1',
                        duplicatorInput: {
                            code: 'product-duplicator',
                            arguments: [
                                {
                                    name: 'includeVariants',
                                    value: 'true',
                                },
                            ],
                        },
                    },
                });
                duplicateEntityGuard.assertSuccess(duplicateEntity);

                const { product: productWithVariantChannelNull } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: duplicateEntity.newEntityId,
                    },
                );

                const productVariantChannelNull = productWithVariantChannelNull!.variants.find(v =>
                    v.sku.startsWith(productVariant.sku),
                );

                expect(productVariantChannelNull!.price).toEqual(productVariant.price);

                adminClient.setChannelToken('second-channel');

                const { duplicateEntity: duplicateEntitySecondChannel } = await adminClient.query(
                    duplicateEntityDocument,
                    {
                        input: {
                            entityName: 'Product',
                            entityId: 'T_1',
                            duplicatorInput: {
                                code: 'product-duplicator',
                                arguments: [
                                    {
                                        name: 'includeVariants',
                                        value: 'true',
                                    },
                                ],
                            },
                        },
                    },
                );
                duplicateEntityGuard.assertSuccess(duplicateEntitySecondChannel);

                const { product: productWithVariantChannel2 } = await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: duplicateEntitySecondChannel.newEntityId,
                    },
                );

                const productVariantChannel2 = productWithVariantChannel2!.variants.find(v =>
                    v.sku.startsWith(productVariant.sku),
                );

                expect(productVariantChannel2!.price).toEqual(productVariant.price + 150);
            });

            it('tax categories are duplicated', async () => {
                // update existing variant with a non 1 first tax category
                // bc tax category defaults to the first available
                const { product } = await adminClient.query(getProductWithVariantsDocument, {
                    id: 'T_1',
                });
                await adminClient.query(updateProductVariantsDocument, {
                    input: [{ id: product!.variants[0].id, taxCategoryId: 'T_2' }],
                });
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Product',
                        entityId: 'T_1',
                        duplicatorInput: {
                            code: 'product-duplicator',
                            arguments: [
                                {
                                    name: 'includeVariants',
                                    value: 'true',
                                },
                            ],
                        },
                    },
                });
                duplicateEntityGuard.assertSuccess(duplicateEntity);
                const { product: productReloaded } = await adminClient.query(getProductWithVariantsDocument, {
                    id: duplicateEntity.newEntityId,
                });
                const variant = productReloaded?.variants.find(v =>
                    v.sku.startsWith(product!.variants[0].sku),
                );
                expect(variant).not.toBeUndefined();
                expect(variant!.taxCategory.id).toEqual('T_2');
            });
        });

        describe('Collection duplicator', () => {
            let testCollection: ResultOf<typeof createCollectionDocument>['createCollection'];
            let duplicatedCollectionId: string;

            beforeAll(async () => {
                await adminClient.asSuperAdmin();

                const { createCollection } = await adminClient.query(createCollectionDocument, {
                    input: {
                        parentId: 'T_2',
                        assetIds: ['T_1'],
                        featuredAssetId: 'T_1',
                        isPrivate: false,
                        inheritFilters: false,
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'Test Collection',
                                description: 'Test Collection description',
                                slug: 'test-collection',
                            },
                        ],
                        filters: [
                            {
                                code: variantIdCollectionFilter.code,
                                arguments: [
                                    {
                                        name: 'variantIds',
                                        value: '["T_1"]',
                                    },
                                    {
                                        name: 'combineWithAnd',
                                        value: 'true',
                                    },
                                ],
                            },
                        ],
                    },
                });
                testCollection = createCollection;
            });

            it('duplicate collection', async () => {
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Collection',
                        entityId: testCollection.id,
                        duplicatorInput: {
                            code: 'collection-duplicator',
                            arguments: [],
                        },
                    },
                });

                duplicateEntityGuard.assertSuccess(duplicateEntity);

                expect(duplicateEntity.newEntityId).toBeDefined();

                duplicatedCollectionId = duplicateEntity.newEntityId;
            });

            it('collection name is suffixed', async () => {
                const { collection } = await adminClient.query(getCollectionDocument, {
                    id: duplicatedCollectionId,
                });

                expect(collection?.name).toBe('Test Collection (copy)');
            });

            it('is initially private', async () => {
                const { collection } = await adminClient.query(getCollectionDocument, {
                    id: duplicatedCollectionId,
                });

                expect(collection?.isPrivate).toBe(true);
            });

            it('assets are duplicated', async () => {
                const { collection } = await adminClient.query(getCollectionDocument, {
                    id: duplicatedCollectionId,
                });

                expect(collection?.featuredAsset).toEqual(testCollection.featuredAsset);
                expect(collection?.assets.length).toBe(1);
                expect(collection?.assets).toEqual(testCollection.assets);
            });

            it('parentId matches', async () => {
                const { collection } = await adminClient.query(getCollectionDocument, {
                    id: duplicatedCollectionId,
                });

                expect(collection?.parent?.id).toBe(testCollection.parent?.id);
            });

            it('filters are duplicated', async () => {
                const { collection } = await adminClient.query(getCollectionDocument, {
                    id: duplicatedCollectionId,
                });

                expect(collection?.filters).toEqual(testCollection.filters);
            });
        });

        describe('Facet duplicator', () => {
            let newFacetId: string;

            it('duplicate facet', async () => {
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Facet',
                        entityId: 'T_1',
                        duplicatorInput: {
                            code: 'facet-duplicator',
                            arguments: [
                                {
                                    name: 'includeFacetValues',
                                    value: 'true',
                                },
                            ],
                        },
                    },
                });

                duplicateEntityGuard.assertSuccess(duplicateEntity);

                expect(duplicateEntity.newEntityId).toBe('T_2');
                newFacetId = duplicateEntity.newEntityId;
            });

            it('facet name is suffixed', async () => {
                const { facet } = await adminClient.query(getFacetWithValuesDocument, {
                    id: newFacetId,
                });

                expect(facet?.name).toBe('category (copy)');
            });

            it('is initially private', async () => {
                const { facet } = await adminClient.query(getFacetWithValuesDocument, {
                    id: newFacetId,
                });

                expect(facet?.isPrivate).toBe(true);
            });

            it('facet values are duplicated', async () => {
                const { facet } = await adminClient.query(getFacetWithValuesDocument, {
                    id: newFacetId,
                });

                expect(facet?.values.map(v => v.name).sort()).toEqual([
                    'computers (copy)',
                    'electronics (copy)',
                ]);
            });
        });

        describe('Promotion duplicator', () => {
            let testPromotion: FragmentOf<typeof promotionFragment>;
            let duplicatedPromotionId: string;
            const promotionGuard: ErrorResultGuard<{ id: string }> = createErrorResultGuard(
                result => !!result.id,
            );

            beforeAll(async () => {
                await adminClient.asSuperAdmin();

                const { createPromotion } = await adminClient.query(createPromotionDocument, {
                    input: {
                        enabled: true,
                        couponCode: 'TEST',
                        perCustomerUsageLimit: 1,
                        usageLimit: 100,
                        startsAt: new Date().toISOString(),
                        endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
                        translations: [
                            {
                                name: 'Test Promotion',
                                description: 'Test Promotion description',
                                languageCode: LanguageCode.en,
                            },
                        ],
                        conditions: [
                            {
                                code: minimumOrderAmount.code,
                                arguments: [
                                    {
                                        name: 'amount',
                                        value: '1000',
                                    },
                                    {
                                        name: 'taxInclusive',
                                        value: 'true',
                                    },
                                ],
                            },
                        ],
                        actions: [
                            {
                                code: freeShipping.code,
                                arguments: [],
                            },
                        ],
                    },
                });

                promotionGuard.assertSuccess(createPromotion);
                testPromotion = createPromotion;
            });

            it('duplicate promotion', async () => {
                const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                    input: {
                        entityName: 'Promotion',
                        entityId: testPromotion.id,
                        duplicatorInput: {
                            code: 'promotion-duplicator',
                            arguments: [],
                        },
                    },
                });

                duplicateEntityGuard.assertSuccess(duplicateEntity);

                expect(testPromotion.id).toBe('T_1');
                expect(duplicateEntity.newEntityId).toBe('T_2');

                duplicatedPromotionId = duplicateEntity.newEntityId;
            });

            it('promotion name is suffixed', async () => {
                const { promotion } = await adminClient.query(getPromotionDocument, {
                    id: duplicatedPromotionId,
                });

                expect(promotion?.name).toBe('Test Promotion (copy)');
            });

            it('is initially disabled', async () => {
                const { promotion } = await adminClient.query(getPromotionDocument, {
                    id: duplicatedPromotionId,
                });

                expect(promotion?.enabled).toBe(false);
            });

            it('properties are duplicated', async () => {
                const { promotion } = await adminClient.query(getPromotionDocument, {
                    id: duplicatedPromotionId,
                });

                expect(promotion?.startsAt).toBe(testPromotion.startsAt);
                expect(promotion?.endsAt).toBe(testPromotion.endsAt);
                expect(promotion?.couponCode).toBe(testPromotion.couponCode);
                expect(promotion?.perCustomerUsageLimit).toBe(testPromotion.perCustomerUsageLimit);
                expect(promotion?.usageLimit).toBe(testPromotion.usageLimit);
            });

            it('conditions are duplicated', async () => {
                const { promotion } = await adminClient.query(getPromotionDocument, {
                    id: duplicatedPromotionId,
                });

                expect(promotion?.conditions).toEqual(testPromotion.conditions);
            });

            it('actions are duplicated', async () => {
                const { promotion } = await adminClient.query(getPromotionDocument, {
                    id: duplicatedPromotionId,
                });

                expect(promotion?.actions).toEqual(testPromotion.actions);
            });
        });
    });
});
