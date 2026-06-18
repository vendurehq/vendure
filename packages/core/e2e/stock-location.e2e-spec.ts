import { CurrencyCode, DeletionResult, LanguageCode, SortOrder } from '@vendure/common/lib/generated-types';
import { mergeConfig } from '@vendure/core';
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

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import {
    testAssignStockLocationToChannelDocument,
    testCreateStockLocationDocument,
    testDeleteStockLocationDocument,
    testGetStockLevelsForVariantDocument,
    testGetStockLocationsListDocument,
    testRemoveStockLocationsFromChannelDocument,
    testSetStockLevelInLocationDocument,
    testUpdateStockLocationDocument,
} from './graphql/admin-definitions';
import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import { FragmentOf as ShopFragmentOf } from './graphql/graphql-shop';
import { assignProductToChannelDocument, createChannelDocument } from './graphql/shared-definitions';
import { localUpdatedOrderFragment, testOrderFragment } from './graphql/shop-definitions';

describe('Stock location', () => {
    const defaultStockLocationId = 'T_1';
    let secondStockLocationId: string;

    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
        }),
    );

    const orderGuard: ErrorResultGuard<
        ShopFragmentOf<typeof testOrderFragment> | ShopFragmentOf<typeof localUpdatedOrderFragment>
    > = createErrorResultGuard(input => !!input.lines);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-stock-control-multi.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('createStockLocation', async () => {
        const { createStockLocation } = await adminClient.query(testCreateStockLocationDocument, {
            input: {
                name: 'Second location',
                description: 'Second location description',
            },
        });

        expect(createStockLocation.name).toBe('Second location');
        expect(createStockLocation.description).toBe('Second location description');
        secondStockLocationId = createStockLocation.id;
    });

    it('updateStockLocation', async () => {
        const { updateStockLocation } = await adminClient.query(testUpdateStockLocationDocument, {
            input: {
                id: secondStockLocationId,
                name: 'Second location updated',
                description: 'Second location description updated',
            },
        });

        expect(updateStockLocation.name).toBe('Second location updated');
        expect(updateStockLocation.description).toBe('Second location description updated');
    });

    it('get stock locations list', async () => {
        const { stockLocations } = await adminClient.query(testGetStockLocationsListDocument, {
            options: {
                sort: {
                    id: SortOrder.ASC,
                },
            },
        });

        expect(stockLocations.items.length).toBe(2);
        expect(stockLocations.items[0].name).toBe('Default Stock Location');
        expect(stockLocations.items[1].name).toBe('Second location updated');
    });

    it('assign stock to second location', async () => {
        const { updateProductVariants } = await adminClient.query(testSetStockLevelInLocationDocument, {
            input: {
                id: 'T_1',
                stockLevels: [
                    {
                        stockLocationId: secondStockLocationId,
                        stockOnHand: 50,
                    },
                ],
            },
        });
        expect(
            updateProductVariants[0]?.stockLevels.find(sl => sl.stockLocationId === defaultStockLocationId),
        ).toEqual({
            stockOnHand: 100,
            stockAllocated: 0,
            stockLocationId: defaultStockLocationId,
        });
        expect(
            updateProductVariants[0]?.stockLevels.find(sl => sl.stockLocationId === secondStockLocationId),
        ).toEqual({
            stockOnHand: 50,
            stockAllocated: 0,
            stockLocationId: secondStockLocationId,
        });
    });

    it('delete second stock location and assign stock to default location', async () => {
        const { deleteStockLocation } = await adminClient.query(testDeleteStockLocationDocument, {
            input: {
                id: secondStockLocationId,
                transferToLocationId: defaultStockLocationId,
            },
        });

        expect(deleteStockLocation.result).toBe(DeletionResult.DELETED);

        const { productVariant } = await adminClient.query(testGetStockLevelsForVariantDocument, {
            id: 'T_1',
        });

        expect(productVariant?.stockLevels.length).toBe(1);
        expect(productVariant?.stockLevels[0]).toEqual({
            stockOnHand: 150,
            stockAllocated: 0,
            stockLocationId: defaultStockLocationId,
        });
    });

    it('cannot delete last remaining stock location', async () => {
        const { deleteStockLocation } = await adminClient.query(testDeleteStockLocationDocument, {
            input: {
                id: defaultStockLocationId,
            },
        });

        expect(deleteStockLocation.result).toBe(DeletionResult.NOT_DELETED);
        expect(deleteStockLocation.message).toBe('The last remaining StockLocation cannot be deleted');

        const { stockLocations } = await adminClient.query(testGetStockLocationsListDocument);

        expect(stockLocations.items.length).toBe(1);
    });

    describe('multi channel', () => {
        const SECOND_CHANNEL_TOKEN = 'second_channel_token';
        let channelStockLocationId: string;
        let secondChannelId: string;
        const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard<
            FragmentOf<typeof channelFragment>
        >(input => !!input.defaultLanguageCode);

        beforeAll(async () => {
            const { createStockLocation } = await adminClient.query(testCreateStockLocationDocument, {
                input: {
                    name: 'Channel location',
                },
            });
            channelStockLocationId = createStockLocation.id;
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
            channelGuard.assertSuccess(createChannel);
            secondChannelId = createChannel.id;

            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: secondChannelId,
                    productIds: ['T_1'],
                },
            });
        });

        it('stock location not visible in channel before being assigned', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { stockLocations } = await adminClient.query(testGetStockLocationsListDocument);

            expect(stockLocations.items.length).toBe(0);
        });

        it('assign stock location to channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignStockLocationsToChannel } = await adminClient.query(
                testAssignStockLocationToChannelDocument,
                {
                    input: {
                        stockLocationIds: [channelStockLocationId],
                        channelId: secondChannelId,
                    },
                },
            );
            expect(assignStockLocationsToChannel.length).toBe(1);
            expect(assignStockLocationsToChannel[0].name).toBe('Channel location');
        });

        it('stock location visible in channel once assigned', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { stockLocations } = await adminClient.query(testGetStockLocationsListDocument);

            expect(stockLocations.items.length).toBe(1);
            expect(stockLocations.items[0].name).toBe('Channel location');
        });

        it('assign stock to location in channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { updateProductVariants } = await adminClient.query(testSetStockLevelInLocationDocument, {
                input: {
                    id: 'T_1',
                    stockLevels: [
                        {
                            stockLocationId: channelStockLocationId,
                            stockOnHand: 10,
                        },
                    ],
                },
            });
        });

        it('assigned variant stock level visible in channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productVariant } = await adminClient.query(testGetStockLevelsForVariantDocument, {
                id: 'T_1',
            });

            expect(productVariant?.stockLevels.length).toBe(1);
            expect(productVariant?.stockLevels[0]).toEqual({
                stockOnHand: 10,
                stockAllocated: 0,
                stockLocationId: channelStockLocationId,
            });
        });

        it('remove stock location from channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removeStockLocationsFromChannel } = await adminClient.query(
                testRemoveStockLocationsFromChannelDocument,
                {
                    input: {
                        stockLocationIds: [channelStockLocationId],
                        channelId: secondChannelId,
                    },
                },
            );

            expect(removeStockLocationsFromChannel.length).toBe(1);
            expect(removeStockLocationsFromChannel[0].name).toBe('Channel location');
        });

        it('variant stock level no longer visible once removed from channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productVariant } = await adminClient.query(testGetStockLevelsForVariantDocument, {
                id: 'T_1',
            });

            expect(productVariant?.stockLevels.length).toBe(0);
        });
    });
});
