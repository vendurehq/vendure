/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, freeShipping, LanguageCode, minimumOrderAmount, Permission } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    assignFacetsToChannelDocument,
    assignProductToChannelDocument,
    createAdministratorDocument,
    createChannelDocument,
    createFacetValuesDocument,
    createProductDocument,
    createProductVariantsDocument,
    createPromotionDocument,
    createRoleDocument,
    duplicateEntityDocument,
    getCollectionsDocument,
    getFacetListSimpleDocument,
    getFacetWithValuesDocument,
    getProductListDocument,
    getProductWithVariantsDocument,
    getPromotionListDocument,
    removeProductVariantFromChannelDocument,
} from './graphql/shared-definitions';

const CHANNEL_B_TOKEN = 'channel-b-token';
const CHANNEL_B_ADMIN_IDENTIFIER = 'channel-b@test.com';
const CHANNEL_B_ADMIN_PASSWORD = 'test';

// The message of an EntityNotFoundError as it appears in `duplicationError`. Errors thrown
// inside a duplicator are surfaced untranslated, so this is the raw i18n key.
const ENTITY_NOT_FOUND_ERROR = 'error.entity-with-id-not-found';

// These ids come from the `initialData` plus the `e2e-products-minimal.csv` fixture,
// all of which are created in the default channel (channel A) only.
const CHANNEL_A_COLLECTION_ID = 'T_2';
const CHANNEL_A_FACET_ID = 'T_1';
const SHARED_PRODUCT_ID = 'T_1';

describe('duplicateEntity channel scope', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const duplicateEntityGuard: ErrorResultGuard<{ newEntityId: string }> = createErrorResultGuard(
        result => !!result.newEntityId,
    );
    const createChannelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
        result => !!result.id,
    );
    const promotionGuard: ErrorResultGuard<{ id: string }> = createErrorResultGuard(result => !!result.id);

    let channelBId: string;
    let channelAProductId: string;
    let channelAPromotionId: string;

    /**
     * Authenticates as the administrator whose role is scoped to channel B only,
     * and sends the channel B token with subsequent requests.
     */
    async function asChannelBAdmin() {
        await adminClient.asUserWithCredentials(CHANNEL_B_ADMIN_IDENTIFIER, CHANNEL_B_ADMIN_PASSWORD);
        adminClient.setChannelToken(CHANNEL_B_TOKEN);
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { createChannel } = await adminClient.query(createChannelDocument, {
            input: {
                code: 'channel-b',
                token: CHANNEL_B_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.USD,
                pricesIncludeTax: false,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });
        createChannelGuard.assertSuccess(createChannel);
        channelBId = createChannel.id;

        // A Product with a variant which exists in the default channel (channel A) only.
        const { createProduct } = await adminClient.query(createProductDocument, {
            input: {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Channel A Product',
                        slug: 'channel-a-product',
                        description: 'Only visible in channel A',
                    },
                ],
            },
        });
        channelAProductId = createProduct.id;
        await adminClient.query(createProductVariantsDocument, {
            input: [
                {
                    productId: channelAProductId,
                    sku: 'CHANNEL-A-SKU',
                    price: 4200,
                    optionIds: [],
                    translations: [{ languageCode: LanguageCode.en, name: 'Channel A Variant' }],
                },
            ],
        });

        // A Promotion which exists in the default channel (channel A) only.
        const { createPromotion } = await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: 'CHANNEL-A-COUPON',
                perCustomerUsageLimit: 1,
                usageLimit: 100,
                startsAt: new Date().toISOString(),
                endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
                translations: [
                    {
                        name: 'Channel A Promotion',
                        description: 'Channel A Promotion description',
                        languageCode: LanguageCode.en,
                    },
                ],
                conditions: [
                    {
                        code: minimumOrderAmount.code,
                        arguments: [
                            { name: 'amount', value: '1000' },
                            { name: 'taxInclusive', value: 'true' },
                        ],
                    },
                ],
                actions: [{ code: freeShipping.code, arguments: [] }],
            },
        });
        promotionGuard.assertSuccess(createPromotion);
        channelAPromotionId = createPromotion.id;

        // An administrator who may only create catalog entities in channel B.
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                channelIds: [channelBId],
                code: 'channel-b-creator',
                description: 'Can create catalog entities in channel B only',
                permissions: [
                    Permission.CreateCatalog,
                    Permission.CreateProduct,
                    Permission.CreateCollection,
                    Permission.CreateFacet,
                    Permission.CreatePromotion,
                ],
            },
        });
        await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Channel B',
                lastName: 'Admin',
                emailAddress: CHANNEL_B_ADMIN_IDENTIFIER,
                password: CHANNEL_B_ADMIN_PASSWORD,
                roleIds: [createRole.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // GHSA-f94w-2928-x43p: each built-in duplicator loaded the source entity without a
    // channel filter, so a channel B admin could copy a channel A entity into channel B.
    describe('cannot duplicate an entity from another channel', () => {
        it('Product', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Product',
                    entityId: channelAProductId,
                    duplicatorInput: {
                        code: 'product-duplicator',
                        arguments: [{ name: 'includeVariants', value: 'true' }],
                    },
                },
            });

            duplicateEntityGuard.assertErrorResult(duplicateEntity);
            expect(duplicateEntity.duplicationError).toBe(ENTITY_NOT_FOUND_ERROR);
        });

        it('Collection', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Collection',
                    entityId: CHANNEL_A_COLLECTION_ID,
                    duplicatorInput: {
                        code: 'collection-duplicator',
                        arguments: [],
                    },
                },
            });

            duplicateEntityGuard.assertErrorResult(duplicateEntity);
            expect(duplicateEntity.duplicationError).toBe(ENTITY_NOT_FOUND_ERROR);
        });

        it('Facet', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Facet',
                    entityId: CHANNEL_A_FACET_ID,
                    duplicatorInput: {
                        code: 'facet-duplicator',
                        arguments: [{ name: 'includeFacetValues', value: 'true' }],
                    },
                },
            });

            duplicateEntityGuard.assertErrorResult(duplicateEntity);
            expect(duplicateEntity.duplicationError).toBe(ENTITY_NOT_FOUND_ERROR);
        });

        it('Promotion', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Promotion',
                    entityId: channelAPromotionId,
                    duplicatorInput: {
                        code: 'promotion-duplicator',
                        arguments: [],
                    },
                },
            });

            duplicateEntityGuard.assertErrorResult(duplicateEntity);
            expect(duplicateEntity.duplicationError).toBe(ENTITY_NOT_FOUND_ERROR);
        });

        it('no copies were created in channel B', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(CHANNEL_B_TOKEN);

            const { products } = await adminClient.query(getProductListDocument, {});
            const { collections } = await adminClient.query(getCollectionsDocument);
            const { facets } = await adminClient.query(getFacetListSimpleDocument, {});
            const { promotions } = await adminClient.query(getPromotionListDocument, {});

            expect(products.items).toEqual([]);
            expect(collections.items).toEqual([]);
            expect(facets.items).toEqual([]);
            expect(promotions.items).toEqual([]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });

    describe('duplication inside the caller channel still works', () => {
        let duplicatedProductId: string;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: channelBId,
                    productIds: [SHARED_PRODUCT_ID],
                },
            });
        });

        it('duplicates a Product which is assigned to the active channel', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Product',
                    entityId: SHARED_PRODUCT_ID,
                    duplicatorInput: {
                        code: 'product-duplicator',
                        arguments: [{ name: 'includeVariants', value: 'true' }],
                    },
                },
            });

            duplicateEntityGuard.assertSuccess(duplicateEntity);
            duplicatedProductId = duplicateEntity.newEntityId;
        });

        it('the duplicated Product keeps its variants', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(CHANNEL_B_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: duplicatedProductId,
            });

            expect(product?.name).toBe('Laptop (copy)');
            expect(product?.variants.length).toBe(4);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });

    // A Product can be assigned to a channel while some of its variants are not, so the
    // variant fetch has to be scoped to the active channel as well as to the Product.
    describe('variants which are not in the caller channel are not copied', () => {
        let removedVariantSku: string;
        let duplicatedProductId: string;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: SHARED_PRODUCT_ID,
            });
            const variantToRemove = product!.variants[0];
            removedVariantSku = variantToRemove.sku;

            await adminClient.query(removeProductVariantFromChannelDocument, {
                input: {
                    channelId: channelBId,
                    productVariantIds: [variantToRemove.id],
                },
            });
        });

        it('duplicates only the variants assigned to the active channel', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Product',
                    entityId: SHARED_PRODUCT_ID,
                    duplicatorInput: {
                        code: 'product-duplicator',
                        arguments: [{ name: 'includeVariants', value: 'true' }],
                    },
                },
            });

            duplicateEntityGuard.assertSuccess(duplicateEntity);
            duplicatedProductId = duplicateEntity.newEntityId;
        });

        it('the copy has one variant fewer and omits the removed SKU', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(CHANNEL_B_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: duplicatedProductId,
            });

            expect(product?.variants.length).toBe(3);
            expect(product?.variants.map(v => v.sku)).not.toContain(`${removedVariantSku}-copy`);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });

    // A Facet can be assigned to a channel while some of its FacetValues are not, so the
    // FacetValue fetch has to be scoped to the active channel as well as to the parent Facet.
    describe('facet values which are not in the caller channel are not copied', () => {
        const CHANNEL_A_ONLY_VALUE_CODE = 'channel-a-only';
        let channelAValueCount: number;
        let duplicatedFacetId: string;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            // Assigning the Facet carries its current values into channel B.
            await adminClient.query(assignFacetsToChannelDocument, {
                input: { channelId: channelBId, facetIds: [CHANNEL_A_FACET_ID] },
            });
            // A value created afterwards in channel A is not in channel B.
            await adminClient.query(createFacetValuesDocument, {
                input: [
                    {
                        facetId: CHANNEL_A_FACET_ID,
                        code: CHANNEL_A_ONLY_VALUE_CODE,
                        translations: [{ languageCode: LanguageCode.en, name: 'Channel A only' }],
                    },
                ],
            });
            const { facet } = await adminClient.query(getFacetWithValuesDocument, { id: CHANNEL_A_FACET_ID });
            channelAValueCount = facet!.values.length;
        });

        it('duplicates only the values assigned to the active channel', async () => {
            await asChannelBAdmin();

            const { duplicateEntity } = await adminClient.query(duplicateEntityDocument, {
                input: {
                    entityName: 'Facet',
                    entityId: CHANNEL_A_FACET_ID,
                    duplicatorInput: {
                        code: 'facet-duplicator',
                        arguments: [{ name: 'includeFacetValues', value: 'true' }],
                    },
                },
            });

            duplicateEntityGuard.assertSuccess(duplicateEntity);
            duplicatedFacetId = duplicateEntity.newEntityId;
        });

        it('the copy has one value fewer and omits the channel A only code', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(CHANNEL_B_TOKEN);

            const { facet } = await adminClient.query(getFacetWithValuesDocument, { id: duplicatedFacetId });

            expect(facet?.values.length).toBe(channelAValueCount - 1);
            expect(facet?.values.map(v => v.code)).not.toContain(`${CHANNEL_A_ONLY_VALUE_CODE}-copy`);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });
});
