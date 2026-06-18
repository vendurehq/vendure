/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { assignAssetsToChannelDocument, getCollectionWithAssetsDocument } from './graphql/admin-definitions';
import {
    assignCollectionsToChannelDocument,
    assignProductToChannelDocument,
    createAssetsDocument,
    createChannelDocument,
    deleteAssetDocument,
    getAssetDocument,
    getProductWithVariantsDocument,
    updateCollectionDocument,
    updateProductDocument,
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
