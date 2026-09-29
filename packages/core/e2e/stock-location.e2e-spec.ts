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
import {
    assignProductToChannelDocument,
    createChannelDocument,
    createProductDocument,
    createProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    getProductWithStockLevelDocument,
    localUpdatedOrderFragment,
    testOrderFragment,
} from './graphql/shop-definitions';

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

        it('assigning a product to the channel seeds a StockLevel for the channel location (#4860)', async () => {
            // Re-assign the product now that the channel has its own stock location: the assignment
            // should create a `stockOnHand: 0` StockLevel for that location, so per-channel inventory
            // is usable immediately (without manually setting any stock).
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: secondChannelId,
                    productIds: ['T_1'],
                },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productVariant } = await adminClient.query(testGetStockLevelsForVariantDocument, {
                id: 'T_1',
            });

            expect(productVariant?.stockLevels.length).toBe(1);
            expect(productVariant?.stockLevels[0]).toEqual({
                stockOnHand: 0,
                stockAllocated: 0,
                stockLocationId: channelStockLocationId,
            });
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

        it('variant created in a channel records numeric stockOnHand at the channel location (#4741)', async () => {
            // Repro for OSS-645: creating a variant while operating in a non-default channel with a
            // numeric `stockOnHand` (as the Dashboard's inline create-variant table does) must record
            // that stock against the *active channel's* stock location, not the global default one.
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel Stock Product',
                            slug: 'channel-stock-product',
                            description: 'Created in the second channel',
                        },
                    ],
                },
            });

            const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId: createProduct.id,
                        sku: 'CHANNEL-STOCK-1',
                        optionIds: [],
                        price: 1000,
                        stockOnHand: 25,
                        translations: [{ languageCode: LanguageCode.en, name: 'Channel Stock Variant' }],
                    },
                ],
            });
            const createdVariant = createProductVariants[0];
            if (!createdVariant) {
                throw new Error('Expected a variant to be created');
            }

            const { productVariant } = await adminClient.query(testGetStockLevelsForVariantDocument, {
                id: createdVariant.id,
            });

            expect(productVariant?.stockLevels.length).toBe(1);
            expect(productVariant?.stockLevels[0]).toEqual({
                stockOnHand: 25,
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

        // Cross-channel update protection
        // Verifies that a channel-scoped admin cannot update a StockLocation belonging
        // to another channel. This is the guard added by the channelId fix.
        describe('cross-channel update protection', () => {
            const CHANNEL_A_TOKEN = 'stock-loc-cross-channel-a';
            const CHANNEL_B_TOKEN = 'stock-loc-cross-channel-b';
            let targetLocationId: string;

            beforeAll(async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                // Create two isolated channels
                for (const [code, token] of [
                    ['stock-loc-cross-a', CHANNEL_A_TOKEN],
                    ['stock-loc-cross-b', CHANNEL_B_TOKEN],
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
                // Create a StockLocation in Channel A
                adminClient.setChannelToken(CHANNEL_A_TOKEN);
                const { createStockLocation } = await adminClient.query(testCreateStockLocationDocument, {
                    input: {
                        name: 'Channel-A Location',
                        description: 'Belongs to Channel A only',
                    },
                });
                targetLocationId = createStockLocation.id;
            });

            afterAll(() => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            });

            it('cannot update a StockLocation belonging to another channel', async () => {
                // Channel B does not contain this StockLocation; the update must be rejected.
                adminClient.setChannelToken(CHANNEL_B_TOKEN);
                await expect(
                    adminClient.query(testUpdateStockLocationDocument, {
                        input: {
                            id: targetLocationId,
                            name: 'PWNED-BY-CHANNEL-B',
                            description: 'TAMPERED-CROSS-CHANNEL',
                        },
                    }),
                ).rejects.toThrow(/No StockLocation with the id .* could be found/);

                // Verify the original entity in Channel A is completely unchanged.
                adminClient.setChannelToken(CHANNEL_A_TOKEN);
                const { stockLocations } = await adminClient.query(testGetStockLocationsListDocument);
                const target = stockLocations.items.find((sl: any) => sl.id === targetLocationId);
                expect(target?.name).toBe('Channel-A Location');
                expect(target?.description).toBe('Belongs to Channel A only');
            });
        });

        // Repro for #3324: the MultiChannelStockLocationStrategy caches each StockLocation's
        // channel ids for 7 days. Assigning a StockLocation to a Channel must invalidate that
        // cache entry, otherwise the new channel sees no saleable stock until the entry expires
        // or the server restarts.
        describe('channelId cache invalidation (#3324)', () => {
            const CACHE_TEST_CHANNEL_TOKEN = 'stock-loc-cache-test';
            const CACHE_REMOVAL_CHANNEL_TOKEN = 'stock-loc-cache-removal';
            let cacheTestChannelId: string;
            let cacheTestLocationId: string;

            // The cache delete runs in an async event subscriber, so the shop query is
            // polled with a deadline rather than assuming a fixed delay. Returns the
            // last observed value so a timeout produces a clear assertion failure.
            async function pollShopStockLevel(expected: string, timeoutMs = 10_000): Promise<string> {
                const deadline = Date.now() + timeoutMs;
                let lastSeen = '';
                for (;;) {
                    const { product } = await shopClient.query(getProductWithStockLevelDocument, {
                        id: 'T_1',
                    });
                    lastSeen = product?.variants[0].stockLevel ?? '';
                    if (lastSeen === expected || Date.now() > deadline) {
                        return lastSeen;
                    }
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            beforeAll(async () => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                const { createStockLocation } = await adminClient.query(testCreateStockLocationDocument, {
                    input: {
                        name: 'Cache test location',
                    },
                });
                cacheTestLocationId = createStockLocation.id;
                await adminClient.query(testSetStockLevelInLocationDocument, {
                    input: {
                        id: 'T_1',
                        stockLevels: [
                            {
                                stockLocationId: cacheTestLocationId,
                                stockOnHand: 10,
                            },
                        ],
                    },
                });
                const { createChannel } = await adminClient.query(createChannelDocument, {
                    input: {
                        code: 'cache-test-channel',
                        token: CACHE_TEST_CHANNEL_TOKEN,
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: CurrencyCode.GBP,
                        pricesIncludeTax: true,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                });
                channelGuard.assertSuccess(createChannel);
                cacheTestChannelId = createChannel.id;
                await adminClient.query(assignProductToChannelDocument, {
                    input: {
                        channelId: cacheTestChannelId,
                        productIds: ['T_1'],
                    },
                });
            });

            afterAll(() => {
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            });

            it('saleable stock becomes visible once the StockLocation is assigned to the channel', async () => {
                // Populate the strategy's channelId cache for the location while it is
                // not yet assigned to the new channel
                shopClient.setChannelToken(CACHE_TEST_CHANNEL_TOKEN);
                const before = await shopClient.query(getProductWithStockLevelDocument, { id: 'T_1' });
                expect(before.product?.variants[0].stockLevel).toBe('OUT_OF_STOCK');

                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(testAssignStockLocationToChannelDocument, {
                    input: {
                        stockLocationIds: [cacheTestLocationId],
                        channelId: cacheTestChannelId,
                    },
                });

                expect(await pollShopStockLevel('IN_STOCK')).toBe('IN_STOCK');
            });

            it('saleable stock disappears once the StockLocation is removed from the channel', async () => {
                // Fresh location + channel: this direction needs a cache entry that is
                // first populated after assignment (warm and including the channel),
                // which the fixtures of the assignment test above cannot provide.
                // Ordering constraint: the location's StockLevel row is created only
                // after the channel assignment, because any admin response that
                // resolves variant stock in between (e.g. assignProductsToChannel)
                // runs the strategy and would seed the cache with the pre-assignment
                // channel list.
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                const { createStockLocation } = await adminClient.query(testCreateStockLocationDocument, {
                    input: {
                        name: 'Cache removal test location',
                    },
                });
                const removalLocationId = createStockLocation.id;
                const { createChannel } = await adminClient.query(createChannelDocument, {
                    input: {
                        code: 'cache-removal-test-channel',
                        token: CACHE_REMOVAL_CHANNEL_TOKEN,
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: CurrencyCode.GBP,
                        pricesIncludeTax: true,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                });
                channelGuard.assertSuccess(createChannel);
                await adminClient.query(assignProductToChannelDocument, {
                    input: {
                        channelId: createChannel.id,
                        productIds: ['T_1'],
                    },
                });
                await adminClient.query(testAssignStockLocationToChannelDocument, {
                    input: {
                        stockLocationIds: [removalLocationId],
                        channelId: createChannel.id,
                    },
                });
                await adminClient.query(testSetStockLevelInLocationDocument, {
                    input: {
                        id: 'T_1',
                        stockLevels: [
                            {
                                stockLocationId: removalLocationId,
                                stockOnHand: 7,
                            },
                        ],
                    },
                });

                // Warm the cache with the post-assignment channel list
                shopClient.setChannelToken(CACHE_REMOVAL_CHANNEL_TOKEN);
                expect(await pollShopStockLevel('IN_STOCK')).toBe('IN_STOCK');

                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(testRemoveStockLocationsFromChannelDocument, {
                    input: {
                        stockLocationIds: [removalLocationId],
                        channelId: createChannel.id,
                    },
                });

                // The removal does not touch the location's stock, so a lingering
                // IN_STOCK below could only come from the stale cached membership
                const { productVariant } = await adminClient.query(testGetStockLevelsForVariantDocument, {
                    id: 'T_1',
                });
                expect(
                    productVariant?.stockLevels.find(sl => sl.stockLocationId === removalLocationId)
                        ?.stockOnHand,
                ).toBe(7);

                expect(await pollShopStockLevel('OUT_OF_STOCK')).toBe('OUT_OF_STOCK');
            });
        });
    });
});
