/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { assignAssetsToChannelDocument, getCollectionWithAssetsDocument } from './graphql/admin-definitions';
import {
    assignCollectionsToChannelDocument,
    assignProductToChannelDocument,
    createAssetsDocument,
    createChannelDocument,
    createCollectionDocument,
    createProductDocument,
    createProductVariantsDocument,
    deleteAssetDocument,
    getAssetDocument,
    getProductWithVariantsDocument,
    updateAssetDocument,
    updateCollectionDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const { server, adminClient } = createTestEnvironment(testConfig());
const SECOND_CHANNEL_TOKEN = 'second_channel_token';
let createdAssetId: string;
let channel2Id: string;
let featuredAssetId: string;

beforeAll(async () => {
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
        customerCount: 1,
    });
    await adminClient.asSuperAdmin();
    const { createChannel } = await adminClient.query(createChannelDocument, {
        input: {
            code: 'second-channel',
            token: SECOND_CHANNEL_TOKEN,
            defaultLanguageCode: LanguageCode.en,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: true,
            defaultShippingZoneId: 'T_1',
            defaultTaxZoneId: 'T_1',
        },
    });
    if ('id' in createChannel) {
        channel2Id = createChannel.id;
    }
}, TEST_SETUP_TIMEOUT_MS);

afterAll(async () => {
    await server.destroy();
});

describe('ChannelAware Assets', () => {
    it('Create asset in default channel', async () => {
        const filesToUpload = [path.join(__dirname, 'fixtures/assets/pps2.jpg')];
        const { createAssets } = await adminClient.fileUploadMutation({
            mutation: createAssetsDocument,
            filePaths: filesToUpload,
            mapVariables: filePaths => ({
                input: filePaths.map(() => ({ file: null })),
            }),
        });

        expect(createAssets.length).toBe(1);
        createdAssetId = createAssets[0].id;
        expect(createdAssetId).toBeDefined();
    });

    it('Get asset from default channel', async () => {
        const { asset } = await adminClient.query(getAssetDocument, {
            id: createdAssetId,
        });
        expect(asset?.id).toEqual(createdAssetId);
    });

    it('Asset is not in channel2', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: createdAssetId,
        });
        expect(asset).toBe(null);
    });

    it('Add asset to channel2', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { assignAssetsToChannel: assets } = await adminClient.query(assignAssetsToChannelDocument, {
            input: {
                assetIds: [createdAssetId],
                channelId: channel2Id,
            },
        });
        expect(assets[0].id).toBe(createdAssetId);
    });

    it('Get asset from channel2', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: createdAssetId,
        });
        expect(asset?.id).toBe(createdAssetId);
    });

    it('Delete asset from channel2', async () => {
        const { deleteAsset } = await adminClient.query(deleteAssetDocument, {
            input: {
                assetId: createdAssetId,
            },
        });
        expect(deleteAsset.result).toBe(DeletionResult.DELETED);
    });

    it('Asset is available in default channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: createdAssetId,
        });
        expect(asset?.id).toEqual(createdAssetId);
    });

    it('Add asset to channel2', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { assignAssetsToChannel: assets } = await adminClient.query(assignAssetsToChannelDocument, {
            input: {
                assetIds: [createdAssetId],
                channelId: channel2Id,
            },
        });
        expect(assets[0].id).toBe(createdAssetId);
    });

    it(
        'Delete asset from all channels with insufficient permission',
        assertThrowsWithMessage(async () => {
            await adminClient.asAnonymousUser();
            await adminClient.query(deleteAssetDocument, {
                input: {
                    assetId: createdAssetId,
                    deleteFromAllChannels: true,
                },
            });
        }, 'You are not currently authorized to perform this action'),
    );

    it('Delete asset from all channels as superadmin', async () => {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { deleteAsset } = await adminClient.query(deleteAssetDocument, {
            input: {
                assetId: createdAssetId,
                deleteFromAllChannels: true,
            },
        });
        expect(deleteAsset.result).toEqual(DeletionResult.DELETED);
    });

    it('Asset is also deleted in default channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: createdAssetId,
        });
        expect(asset?.id).toBeUndefined();
    });
});

describe('Product related assets', () => {
    it('Featured asset is available in default channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: 'T_1',
        });
        featuredAssetId = product!.featuredAsset!.id;
        expect(featuredAssetId).toBeDefined();

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: featuredAssetId,
        });
        expect(asset?.id).toEqual(featuredAssetId);
    });

    it('Featured asset is not available in channel2', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: featuredAssetId,
        });
        expect(asset?.id).toBeUndefined();
    });

    it('Add Product to channel2', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: channel2Id,
                productIds: ['T_1'],
            },
        });
        expect(assignProductsToChannel[0].id).toEqual('T_1');
        expect(assignProductsToChannel[0].channels.map(c => c.id)).toContain(channel2Id);
    });

    it('Get featured asset from channel2', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: featuredAssetId,
        });
        expect(asset?.id).toEqual(featuredAssetId);
    });

    it('Add Product 2 to channel2', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
            input: {
                channelId: channel2Id,
                productIds: ['T_2'],
            },
        });
        expect(assignProductsToChannel[0].id).toEqual('T_2');
        expect(assignProductsToChannel[0].channels.map(c => c.id)).toContain(channel2Id);
    });

    it('Add asset A to Product 2 in default channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { updateProduct } = await adminClient.query(updateProductDocument, {
            input: {
                id: 'T_2',
                assetIds: ['T_3'],
            },
        });
        expect(updateProduct.assets.map(a => a.id)).toContain('T_3');
    });

    it('Channel2 does not have asset A', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: 'T_2',
        });
        expect(product!.assets.find(a => a.id === 'T_3')).toBeUndefined();
    });

    it('Updating product with asset IDs not in channel does not crash', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        // T_3 is not assigned to channel2, so findByIdsInChannel returns empty.
        // This should not crash and should clear the product's assets.
        const { updateProduct } = await adminClient.query(updateProductDocument, {
            input: {
                id: 'T_2',
                assetIds: ['T_3'],
            },
        });
        expect(updateProduct.assets).toEqual([]);
    });

    // #5629 — updating the assets of a Product in one channel should keep its assets of other channels
    describe('updating assets in channel2', () => {
        let productId: string;
        let variantId: string;
        let defaultChannelAssetId: string;
        let sharedAssetId: string;
        let productCount = 0;

        async function createAssets(count: number): Promise<string[]> {
            const { createAssets: assets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: Array.from({ length: count }, () =>
                    path.join(__dirname, 'fixtures/assets/box-of-8.jpg'),
                ),
                mapVariables: filePaths => ({
                    input: filePaths.map(() => ({ file: null })),
                }),
            });
            return assets.map((asset: { id: string }) => asset.id);
        }

        // Each test gets a new Product with one ProductVariant, in both channels.
        // The Product has one Asset, defaultChannelAssetId, which is only in the default channel.
        // That Asset is also its featured Asset.
        // sharedAssetId is in both channels and is not yet an Asset of the Product.
        // New entities are used because assigning a Product to a channel also assigns its Assets.
        // Other tests in this file depend on which of the existing Assets are in channel2.
        beforeEach(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            [defaultChannelAssetId, sharedAssetId] = await createAssets(2);
            productCount++;
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: `Channel assets ${productCount}`,
                            slug: `channel-assets-${productCount}`,
                            description: '',
                        },
                    ],
                },
            });
            productId = createProduct.id;
            const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId,
                        sku: `channel-assets-${productCount}`,
                        price: 100,
                        translations: [
                            { languageCode: LanguageCode.en, name: `Channel assets ${productCount}` },
                        ],
                    },
                ],
            });
            variantId = createProductVariants[0]!.id;
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: channel2Id, productIds: [productId] },
            });
            await adminClient.query(assignAssetsToChannelDocument, {
                input: { assetIds: [sharedAssetId], channelId: channel2Id },
            });
            await adminClient.query(updateProductDocument, {
                input: {
                    id: productId,
                    assetIds: [defaultChannelAssetId],
                    featuredAssetId: defaultChannelAssetId,
                },
            });
        });

        it('keeps the assets of other channels', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProduct } = await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId] },
            });
            expect(updateProduct.assets.map(a => a.id)).toEqual([sharedAssetId]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            // The Asset added in channel2 is placed after the existing Assets
            expect(product!.assets.map(a => a.id)).toEqual([defaultChannelAssetId, sharedAssetId]);
        });

        // #5629 — saving the assets in channel2 should not change their order in other channels
        it('preserves the order of the assets in other channels', async () => {
            await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId, defaultChannelAssetId] },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId] },
            });

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(product!.assets.map(a => a.id)).toEqual([sharedAssetId, defaultChannelAssetId]);
        });

        // #5629 — an asset added in channel2 should go after all existing assets
        it('places an asset added in channel2 after the assets of other channels', async () => {
            const [sharedAssetId2] = await createAssets(1);
            await adminClient.query(assignAssetsToChannelDocument, {
                input: { assetIds: [sharedAssetId2], channelId: channel2Id },
            });
            await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId, defaultChannelAssetId] },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProduct } = await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId, sharedAssetId2] },
            });
            expect(updateProduct.assets.map(a => a.id)).toEqual([sharedAssetId, sharedAssetId2]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(product!.assets.map(a => a.id)).toEqual([
                sharedAssetId,
                defaultChannelAssetId,
                sharedAssetId2,
            ]);
        });

        // #5629 — reordering the assets in channel2 should keep the positions of other channels' assets
        it('reorders the assets of channel2 around the assets of other channels', async () => {
            const [sharedAssetId2] = await createAssets(1);
            await adminClient.query(assignAssetsToChannelDocument, {
                input: { assetIds: [sharedAssetId2], channelId: channel2Id },
            });
            await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId, defaultChannelAssetId, sharedAssetId2] },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProduct } = await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId2, sharedAssetId] },
            });
            expect(updateProduct.assets.map(a => a.id)).toEqual([sharedAssetId2, sharedAssetId]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(product!.assets.map(a => a.id)).toEqual([
                sharedAssetId2,
                defaultChannelAssetId,
                sharedAssetId,
            ]);
        });

        // #5629 — the featured asset is a single column shared by all channels, so clearing it
        // explicitly in channel2 also clears it in the default channel
        it('clears the featured asset in all channels with featuredAssetId: null', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProduct } = await adminClient.query(updateProductDocument, {
                input: { id: productId, featuredAssetId: null },
            });
            expect(updateProduct.featuredAsset).toBeNull();

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(product!.featuredAsset).toBeNull();
            expect(product!.assets.map(a => a.id)).toEqual([defaultChannelAssetId]);
        });

        // #5629 — the same applies to the assets of a ProductVariant
        it('keeps the assets of other channels of a ProductVariant', async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: variantId, assetIds: [defaultChannelAssetId] }],
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: variantId, assetIds: [sharedAssetId] }],
            });
            expect(updateProductVariants[0]!.assets.map(a => a.id)).toEqual([sharedAssetId]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            const variant = product!.variants.find(v => v.id === variantId);
            expect(variant!.assets.map(a => a.id)).toEqual([defaultChannelAssetId, sharedAssetId]);
        });

        // #5629 — the same applies to the assets of a Collection
        it('keeps the assets of other channels of a Collection', async () => {
            const { createCollection } = await adminClient.query(createCollectionDocument, {
                input: {
                    filters: [],
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: `Channel assets ${productCount}`,
                            slug: `channel-assets-collection-${productCount}`,
                            description: '',
                        },
                    ],
                },
            });
            const collectionId = createCollection.id;
            await adminClient.query(assignCollectionsToChannelDocument, {
                input: { channelId: channel2Id, collectionIds: [collectionId] },
            });
            await adminClient.query(updateCollectionDocument, {
                input: { id: collectionId, assetIds: [defaultChannelAssetId] },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateCollection } = await adminClient.query(updateCollectionDocument, {
                input: { id: collectionId, assetIds: [sharedAssetId] },
            });
            expect(updateCollection.assets.map(a => a.id)).toEqual([sharedAssetId]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { collection } = await adminClient.query(getCollectionWithAssetsDocument, {
                id: collectionId,
            });
            expect(collection!.assets.map(a => a.id)).toEqual([defaultChannelAssetId, sharedAssetId]);
        });

        it('keeps the featured asset of another channel when all assets are removed', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProduct } = await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [] },
            });
            expect(updateProduct.assets).toEqual([]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(product!.assets.map(a => a.id)).toEqual([defaultChannelAssetId]);
            expect(product!.featuredAsset?.id).toBe(defaultChannelAssetId);
        });

        // #5629 — removing all assets in channel2 should clear a featured asset of channel2
        it('clears the featured asset of channel2 when all assets are removed', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProduct: withFeaturedAsset } = await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [sharedAssetId], featuredAssetId: sharedAssetId },
            });
            expect(withFeaturedAsset.featuredAsset?.id).toBe(sharedAssetId);

            const { updateProduct } = await adminClient.query(updateProductDocument, {
                input: { id: productId, assetIds: [] },
            });
            expect(updateProduct.assets).toEqual([]);
            expect(updateProduct.featuredAsset).toBeNull();

            const { product: channel2Product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(channel2Product!.featuredAsset).toBeNull();

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: productId,
            });
            expect(product!.featuredAsset).toBeNull();
            expect(product!.assets.map(a => a.id)).toEqual([defaultChannelAssetId]);
        });
    });
});

describe('Collection related assets', () => {
    let collectionFeaturedAssetId: string;
    it('Featured asset is available in default channel', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

        await adminClient.query(updateCollectionDocument, {
            input: {
                id: 'T_2',
                featuredAssetId: 'T_3',
                assetIds: ['T_3'],
            },
        });

        const { collection } = await adminClient.query(getCollectionWithAssetsDocument, {
            id: 'T_2',
        });
        collectionFeaturedAssetId = collection!.featuredAsset!.id;
        expect(collectionFeaturedAssetId).toBeDefined();

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: collectionFeaturedAssetId,
        });
        expect(asset?.id).toEqual(collectionFeaturedAssetId);
    });

    it('Featured asset is not available in channel2', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: collectionFeaturedAssetId,
        });
        expect(asset?.id).toBeUndefined();
    });

    it('Add Collection to channel2', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { assignCollectionsToChannel } = await adminClient.query(assignCollectionsToChannelDocument, {
            input: {
                channelId: channel2Id,
                collectionIds: ['T_2'],
            },
        });
        expect(assignCollectionsToChannel[0].id).toEqual('T_2');
    });

    it('Get featured asset from channel2', async () => {
        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: collectionFeaturedAssetId,
        });
        expect(asset?.id).toEqual(collectionFeaturedAssetId);
    });
});

// Cross-channel update protection
// Verifies that a channel-scoped admin cannot update an Asset belonging to
// another channel. This is the guard that should use { channelId: ctx.channelId }
// in asset.service.ts update().
describe('cross-channel update protection', () => {
    const CHANNEL_A_TOKEN = 'asset-cross-channel-a';
    const CHANNEL_B_TOKEN = 'asset-cross-channel-b';
    let targetAssetId: string;

    beforeAll(async () => {
        await adminClient.asSuperAdmin();
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        // Create two isolated channels
        for (const [code, token] of [
            ['asset-cross-a', CHANNEL_A_TOKEN],
            ['asset-cross-b', CHANNEL_B_TOKEN],
        ]) {
            await adminClient.query(createChannelDocument, {
                input: {
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
        }
        // Create an Asset in Channel A via file upload
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        const filesToUpload = [path.join(__dirname, 'fixtures/assets/pps2.jpg')];
        const { createAssets } = await adminClient.fileUploadMutation({
            mutation: createAssetsDocument,
            filePaths: filesToUpload,
            mapVariables: filePaths => ({
                input: filePaths.map(() => ({ file: null })),
            }),
        });
        targetAssetId = createAssets[0].id;
    });

    afterAll(() => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    });

    it('cannot update an Asset belonging to another channel', async () => {
        // Channel B does not contain this Asset; the update must be rejected.
        adminClient.setChannelToken(CHANNEL_B_TOKEN);
        await expect(
            adminClient.query(updateAssetDocument, {
                input: {
                    id: targetAssetId,
                    name: 'PWNED-BY-CHANNEL-B',
                },
            }),
        ).rejects.toThrow(/No Asset with the id .* could be found/);

        // Verify the original Asset in Channel A is completely unchanged.
        adminClient.setChannelToken(CHANNEL_A_TOKEN);
        const { asset } = await adminClient.query(getAssetDocument, {
            id: targetAssetId,
        });
        expect(asset?.name).toBe('pps2.jpg');
    });
});
