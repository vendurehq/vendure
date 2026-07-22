import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import type { ErrorResultGuard } from '@vendure/testing';
import { createErrorResultGuard, createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import { fail } from 'assert';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FragmentOf, ResultOf } from './graphql/graphql-admin';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment, productVariantFragment } from './graphql/fragments-admin';
import { graphql } from './graphql/graphql-admin';
import {
    addOptionGroupToProductDocument,
    assignProductToChannelDocument,
    assignProductVariantToChannelDocument,
    createAdministratorDocument,
    createAssetsDocument,
    createChannelDocument,
    createProductDocument,
    createProductOptionGroupDocument,
    createProductVariantsDocument,
    createRoleDocument,
    getChannelsDocument,
    getProductVariantListDocument,
    getProductWithVariantsDocument,
    removeProductFromChannelDocument,
    removeProductVariantFromChannelDocument,
    updateChannelDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

describe('ChannelAware Products and ProductVariants', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    const SECOND_CHANNEL_TOKEN = 'second_channel_token';
    const THIRD_CHANNEL_TOKEN = 'third_channel_token';

    let secondChannelAdminRole: ResultOf<typeof createRoleDocument>['createRole'];
    const orderResultGuard: ErrorResultGuard<{ lines: Array<{ id: string }> }> = createErrorResultGuard(
        input => !!input.lines,
    );
    const productGuard: ErrorResultGuard<
        NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>
    > = createErrorResultGuard(input => !!input.id);
    const productVariantGuard: ErrorResultGuard<FragmentOf<typeof productVariantFragment>> =
        createErrorResultGuard(input => !!input.id);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        await adminClient.query(createChannelDocument, {
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

        await adminClient.query(createChannelDocument, {
            input: {
                code: 'third-channel',
                token: THIRD_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.en,
                currencyCode: CurrencyCode.EUR,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });

        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                description: 'second channel admin',
                code: 'second-channel-admin',
                channelIds: ['T_2'],
                permissions: [
                    Permission.ReadCatalog,
                    Permission.ReadSettings,
                    Permission.ReadAdministrator,
                    Permission.CreateAdministrator,
                    Permission.UpdateAdministrator,
                ],
            },
        });
        secondChannelAdminRole = createRole;

        await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Admin',
                lastName: 'Two',
                emailAddress: 'admin2@test.com',
                password: 'test',
                roleIds: [secondChannelAdminRole.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('assigning Product to Channels', () => {
        let product1: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });
            productGuard.assertSuccess(product);
            product1 = product;
        });

        it(
            'throws if attempting to assign Product to channel to which the admin has no access',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials('admin2@test.com', 'test');
                await adminClient.query(assignProductToChannelDocument, {
                    input: {
                        channelId: 'T_3',
                        productIds: [product1.id],
                    },
                });
            }, 'You are not currently authorized to perform this action'),
        );

        it('assigns Product to Channel and applies price factor', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const PRICE_FACTOR = 0.5;
            await adminClient.asSuperAdmin();
            const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: 'T_2',
                    productIds: [product1.id],
                    priceFactor: PRICE_FACTOR,
                },
            });

            expect(assignProductsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_2']);
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });
            productGuard.assertSuccess(product);

            expect(product.variants.map(v => v.price)).toEqual(
                product1.variants.map(v => Math.round(v.price * PRICE_FACTOR)),
            );
            // Second Channel is configured to include taxes in price, so they should be the same.
            expect(product.variants.map(v => v.priceWithTax)).toEqual(
                product1.variants.map(v => Math.round(v.priceWithTax * PRICE_FACTOR)),
            );
            // Second Channel has the default currency of GBP, so the prices should be the same.
            expect(product.variants.map(v => v.currencyCode)).toEqual(['GBP', 'GBP', 'GBP', 'GBP']);
        });

        it('ProductVariant.channels includes all Channels from default Channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });

            expect(product?.variants[0].channels.map(c => c.id)).toEqual(['T_1', 'T_2']);
        });

        it('ProductVariant.channels includes only current Channel from non-default Channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });

            expect(product?.variants[0].channels.map(c => c.id)).toEqual(['T_2']);
        });

        it('does not assign Product to same channel twice', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: 'T_2',
                    productIds: [product1.id],
                },
            });

            expect(assignProductsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_2']);
        });

        // https://github.com/vendurehq/vendure/issues/4614
        it('assigns Product without variants to Channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();

            // Create a product with no variants
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Product Without Variants',
                            slug: 'product-without-variants',
                            description: '',
                        },
                    ],
                },
            });

            expect(createProduct.variants).toEqual([]);

            // Assign the variant-less product to the second channel
            const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: 'T_2',
                    productIds: [createProduct.id],
                },
            });

            expect(assignProductsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_2']);

            // Verify the product is visible from the second channel
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: createProduct.id,
            });
            productGuard.assertSuccess(product);
            expect(product.id).toBe(createProduct.id);
            expect(product.name).toBe('Product Without Variants');
        });

        it(
            'throws if attempting to remove Product from default Channel',
            assertThrowsWithMessage(async () => {
                await adminClient.query(removeProductFromChannelDocument, {
                    input: {
                        productIds: [product1.id],
                        channelId: 'T_1',
                    },
                });
            }, 'Items cannot be removed from the default Channel'),
        );

        it('removes Product from Channel', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removeProductsFromChannel } = await adminClient.query(removeProductFromChannelDocument, {
                input: {
                    productIds: [product1.id],
                    channelId: 'T_2',
                },
            });

            expect(removeProductsFromChannel[0].channels.map(c => c.id)).toEqual(['T_1']);
        });

        // https://github.com/vendurehq/vendure/issues/2716
        it('querying an Order with a variant that was since removed from the channel', async () => {
            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: 'T_2',
                    productIds: [product1.id],
                    priceFactor: 1,
                },
            });

            // Create an order in the second channel with the variant just assigned
            shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
                productVariantId: product1.variants[0].id,
                quantity: 1,
            });
            orderResultGuard.assertSuccess(addItemToOrder);

            // Now remove that variant from the second channel
            await adminClient.query(removeProductFromChannelDocument, {
                input: {
                    productIds: [product1.id],
                    channelId: 'T_2',
                },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

            // If no price fields are requested on the ProductVariant, then the query will
            // succeed even if the ProductVariant is no longer assigned to the channel.
            const GET_ORDER_WITHOUT_VARIANT_PRICE = `
            query GetOrderWithoutVariantPrice($id: ID!) {
              order(id: $id) {
                id
                lines {
                  id
                  linePrice
                  productVariant {
                    id
                    name
                  }
                }
              }
            }`;
            const { order } = await adminClient.query(gql(GET_ORDER_WITHOUT_VARIANT_PRICE), {
                id: addItemToOrder.id,
            });

            expect(order).toEqual({
                id: 'T_1',
                lines: [
                    {
                        id: 'T_1',
                        linePrice: 129900,
                        productVariant: {
                            id: 'T_1',
                            name: 'Laptop 13 inch 8GB',
                        },
                    },
                ],
            });

            try {
                // The API will only throw if one of the price fields is requested in the query
                const GET_ORDER_WITH_VARIANT_PRICE = `
                query GetOrderWithVariantPrice($id: ID!) {
                  order(id: $id) {
                    id
                    lines {
                      id
                      linePrice
                      productVariant {
                        id
                        name
                        price
                      }
                    }
                  }
                }`;
                await adminClient.query(gql(GET_ORDER_WITH_VARIANT_PRICE), {
                    id: addItemToOrder.id,
                });
                fail(`Should have thrown`);
            } catch (e: unknown) {
                expect((e as Error).message).toContain(
                    'No price information was found for ProductVariant ID "1" in the Channel "second-channel"',
                );
            }
        });
    });

    describe('assigning ProductVariant to Channels', () => {
        let product1: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_2',
            });
            productGuard.assertSuccess(product);
            product1 = product;
        });

        it(
            'throws if attempting to assign ProductVariant to channel to which the admin has no access',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials('admin2@test.com', 'test');
                await adminClient.query(assignProductVariantToChannelDocument, {
                    input: {
                        channelId: 'T_3',
                        productVariantIds: [product1.variants[0].id],
                    },
                });
            }, 'You are not currently authorized to perform this action'),
        );

        it('assigns ProductVariant to Channel and applies price factor', async () => {
            const PRICE_FACTOR = 0.5;
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignProductVariantsToChannel } = await adminClient.query(
                assignProductVariantToChannelDocument,
                {
                    input: {
                        channelId: 'T_3',
                        productVariantIds: [product1.variants[0].id],
                        priceFactor: PRICE_FACTOR,
                    },
                },
            );

            expect(assignProductVariantsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });
            productGuard.assertSuccess(product);
            expect(product.channels.map(c => c.id).sort()).toEqual(['T_3']);
            // Third Channel is configured to include taxes in price, so they should be the same.
            expect(product.variants.map(v => v.priceWithTax)).toEqual([
                Math.round(product1.variants[0].priceWithTax * PRICE_FACTOR),
            ]);

            // Third Channel has the default currency EUR
            expect(product.variants.map(v => v.currencyCode)).toEqual(['EUR']);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: check } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });
            productGuard.assertSuccess(check);

            // from the default channel, all channels are visible
            expect(check.channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);
            expect(check.variants[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);
            expect(check.variants[1].channels.map(c => c.id).sort()).toEqual(['T_1']);
        });

        it('does not assign ProductVariant to same channel twice', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignProductVariantsToChannel } = await adminClient.query(
                assignProductVariantToChannelDocument,
                {
                    input: {
                        channelId: 'T_3',
                        productVariantIds: [product1.variants[0].id],
                    },
                },
            );
            expect(assignProductVariantsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);
        });

        it(
            'throws if attempting to remove ProductVariant from default Channel',
            assertThrowsWithMessage(async () => {
                await adminClient.query(removeProductVariantFromChannelDocument, {
                    input: {
                        productVariantIds: [product1.variants[0].id],
                        channelId: 'T_1',
                    },
                });
            }, 'Items cannot be removed from the default Channel'),
        );

        it('removes ProductVariant but not Product from Channel', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignProductVariantsToChannel } = await adminClient.query(
                assignProductVariantToChannelDocument,
                {
                    input: {
                        channelId: 'T_3',
                        productVariantIds: [product1.variants[1].id],
                    },
                },
            );
            expect(assignProductVariantsToChannel[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);

            const { removeProductVariantsFromChannel } = await adminClient.query(
                removeProductVariantFromChannelDocument,
                {
                    input: {
                        productVariantIds: [product1.variants[1].id],
                        channelId: 'T_3',
                    },
                },
            );
            expect(removeProductVariantsFromChannel[0].channels.map(c => c.id)).toEqual(['T_1']);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });
            productGuard.assertSuccess(product);
            expect(product.channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);
        });

        it('removes ProductVariant and Product from Channel', async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removeProductVariantsFromChannel } = await adminClient.query(
                removeProductVariantFromChannelDocument,
                {
                    input: {
                        productVariantIds: [product1.variants[0].id],
                        channelId: 'T_3',
                    },
                },
            );

            expect(removeProductVariantsFromChannel[0].channels.map(c => c.id)).toEqual(['T_1']);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: product1.id,
            });
            productGuard.assertSuccess(product);
            expect(product.channels.map(c => c.id).sort()).toEqual(['T_1']);
        });
    });

    describe('creating Product in sub-channel', () => {
        let createdProduct: ResultOf<typeof createProductDocument>['createProduct'];
        let createdVariant: FragmentOf<typeof productVariantFragment>;

        it('creates a Product in sub-channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel Product',
                            slug: 'channel-product',
                            description: 'Channel product',
                        },
                    ],
                },
            });
            const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId: createProduct.id,
                        sku: 'PV1',
                        optionIds: [],
                        translations: [{ languageCode: LanguageCode.en, name: 'Variant 1' }],
                    },
                ],
            });

            createdProduct = createProduct;
            const firstVariant = createProductVariants[0];
            productVariantGuard.assertSuccess(firstVariant);
            createdVariant = firstVariant;

            // from sub-channel, only that channel is visible
            expect(createdProduct.channels.map(c => c.id).sort()).toEqual(['T_2']);
            expect(createdVariant.channels.map(c => c.id).sort()).toEqual(['T_2']);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: createProduct.id,
            });
            productGuard.assertSuccess(product);

            // from the default channel, all channels are visible
            expect(product.channels.map(c => c.id).sort()).toEqual(['T_1', 'T_2']);
            expect(product.variants[0].channels.map(c => c.id).sort()).toEqual(['T_1', 'T_2']);
        });
    });

    // https://github.com/vendure-ecommerce/vendure/issues/4532
    describe('creating a new variant for a product already assigned to another channel', () => {
        let testProduct: ResultOf<typeof createProductDocument>['createProduct'];
        let colorGroupId: string;
        let redOptionId: string;
        let assetId: string;

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            // Create an asset in the default channel to attach to the new variant
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: [path.join(__dirname, 'fixtures/assets/pps2.jpg')],
                mapVariables: filePaths => ({
                    input: filePaths.map(() => ({ file: null })),
                }),
            });
            assetId = createAssets[0].id;

            // Create a product in the default channel
            const { createProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel Variant Test Product',
                            slug: 'channel-variant-test-product',
                            description: 'Testing variant channel inheritance',
                        },
                    ],
                },
            });
            testProduct = createProduct;

            // Create an option group with one option
            const { createProductOptionGroup } = await adminClient.query(
                createProductOptionGroupDocument,
                {
                    input: {
                        code: 'test-color',
                        translations: [{ languageCode: LanguageCode.en, name: 'Color' }],
                        options: [
                            {
                                code: 'red',
                                translations: [{ languageCode: LanguageCode.en, name: 'Red' }],
                            },
                        ],
                    },
                },
            );
            colorGroupId = createProductOptionGroup.id;
            redOptionId = createProductOptionGroup.options[0].id;

            // Attach option group to product
            await adminClient.query(addOptionGroupToProductDocument, {
                productId: testProduct.id,
                optionGroupId: colorGroupId,
            });

            // Create first variant with the red option
            const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId: testProduct.id,
                        sku: 'CHAN-VAR-RED',
                        price: 1000,
                        optionIds: [redOptionId],
                        translations: [{ languageCode: LanguageCode.en, name: 'Red Variant' }],
                    },
                ],
            });
            productVariantGuard.assertSuccess(createProductVariants[0]);

            // Assign the product to the third channel (pricesIncludeTax: true, EUR)
            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: 'T_3',
                    productIds: [testProduct.id],
                    priceFactor: 1,
                },
            });

            // Assign the default stock location to the third channel so that
            // ensureStockLevelsForChannel has a location to seed StockLevels at when the
            // new variant is created (new channels do not get a stock location by default).
            const { stockLocations } = await adminClient.query(getStockLocationsDocument);
            await adminClient.query(assignStockLocationToChannelDocument, {
                input: {
                    channelId: 'T_3',
                    stockLocationIds: [stockLocations.items[0].id],
                },
            });
        });

        it('new variant is automatically assigned to the same channels as the product', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            // Create a new option after the product was assigned to the channel
            const { createProductOption } = await adminClient.query(createProductOptionDocument, {
                input: {
                    productOptionGroupId: colorGroupId,
                    code: 'blue',
                    translations: [{ languageCode: LanguageCode.en, name: 'Blue' }],
                },
            });

            // Create a new variant with the new option
            const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                input: [
                    {
                        productId: testProduct.id,
                        sku: 'CHAN-VAR-BLUE',
                        price: 2000,
                        optionIds: [createProductOption.id],
                        assetIds: [assetId],
                        featuredAssetId: assetId,
                        translations: [{ languageCode: LanguageCode.en, name: 'Blue Variant' }],
                    },
                ],
            });
            const newVariant = createProductVariants[0];
            productVariantGuard.assertSuccess(newVariant);

            // From the default channel, the new variant should be in both channels
            expect(newVariant.channels.map(c => c.id).sort()).toEqual(['T_1', 'T_3']);
        });

        it('new variant is visible in the assigned channel', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: testProduct.id,
            });
            productGuard.assertSuccess(product);

            // Both variants should be visible in the third channel
            expect(product.variants).toHaveLength(2);
            expect(product.variants.map(v => v.sku).sort()).toEqual([
                'CHAN-VAR-BLUE',
                'CHAN-VAR-RED',
            ]);
        });

        it('new variant has correct price in the tax-inclusive assigned channel', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: testProduct.id,
            });
            productGuard.assertSuccess(product);

            const blueVariant = product.variants.find(v => v.sku === 'CHAN-VAR-BLUE');
            expect(blueVariant).toBeDefined();
            // Third channel has pricesIncludeTax: true and uses EUR.
            // assignProductVariantsToChannel writes the variant's net price (2000) as the
            // channel price; with 20% tax applied the gross priceWithTax is 2000 * 1.2 = 2400.
            expect(blueVariant!.priceWithTax).toBe(2400);
            expect(blueVariant!.currencyCode).toBe(CurrencyCode.EUR);
        });

        it('new variant has stock initialized in the assigned channel', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: testProduct.id,
            });
            productGuard.assertSuccess(product);
            const blueVariant = product.variants.find(v => v.sku === 'CHAN-VAR-BLUE');
            expect(blueVariant).toBeDefined();

            // Assert on the channel-filtered `stockLevels` array (queried from the third
            // channel) rather than `stockOnHand` — this proves ensureStockLevelsForChannel
            // actually seeded a StockLevel row for the third channel's stock location,
            // which a `stockOnHand === 0` check alone could not distinguish from "no row".
            const { productVariants } = await adminClient.query(getVariantStockLevelsDocument, {
                options: { filter: { id: { eq: blueVariant!.id } } },
            });
            const stockLevels = productVariants.items[0]?.stockLevels ?? [];
            expect(stockLevels.length).toBeGreaterThan(0);
            expect(stockLevels[0].stockOnHand).toBe(0);
        });

        it('new variant assets are assigned to the assigned channel', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: testProduct.id,
            });
            productGuard.assertSuccess(product);

            const blueVariant = product.variants.find(v => v.sku === 'CHAN-VAR-BLUE');
            expect(blueVariant).toBeDefined();
            // The asset attached at creation time should be assigned to the third channel
            // (via assetService.assignToChannel inside assignProductVariantsToChannel)
            // and therefore visible/resolvable when querying from that channel.
            expect(blueVariant!.assets).toHaveLength(1);
            expect(blueVariant!.assets[0].id).toBe(assetId);
            expect(blueVariant!.featuredAsset).toBeDefined();
            expect(blueVariant!.featuredAsset!.id).toBe(assetId);
        });

        it('new variant options and option groups are accessible in the assigned channel', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: testProduct.id,
            });
            productGuard.assertSuccess(product);

            // The option group should be visible in the third channel
            expect(product.optionGroups).toHaveLength(1);
            expect(product.optionGroups[0].code).toBe('test-color');

            // The new variant's options should have valid group references
            const blueVariant = product.variants.find(v => v.sku === 'CHAN-VAR-BLUE');
            expect(blueVariant).toBeDefined();
            expect(blueVariant!.options).toHaveLength(1);
            expect(blueVariant!.options[0].code).toBe('blue');
            expect(blueVariant!.options[0].groupId).toBe(product.optionGroups[0].id);
        });

        it(
            'respects permissions: throws if user lacks UpdateCatalog on a target channel',
            assertThrowsWithMessage(async () => {
                await adminClient.asSuperAdmin();
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

                // Create a new option so we have a valid optionId for the variant
                const { createProductOption } = await adminClient.query(createProductOptionDocument, {
                    input: {
                        productOptionGroupId: colorGroupId,
                        code: 'green',
                        translations: [{ languageCode: LanguageCode.en, name: 'Green' }],
                    },
                });

                // Create a role with UpdateCatalog only on the default channel
                const { createRole } = await adminClient.query(createRoleDocument, {
                    input: {
                        description: 'default-channel-catalog-admin',
                        code: 'default-channel-catalog-admin',
                        channelIds: ['T_1'],
                        permissions: [Permission.UpdateCatalog, Permission.ReadCatalog],
                    },
                });
                await adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Limited',
                        lastName: 'Admin',
                        emailAddress: 'limited-admin@test.com',
                        password: 'test',
                        roleIds: [createRole.id],
                    },
                });

                // This user can create variants on the default channel,
                // but lacks UpdateCatalog on T_3 where the product is also assigned.
                // assignProductVariantsToChannel should throw ForbiddenError.
                await adminClient.asUserWithCredentials('limited-admin@test.com', 'test');
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: testProduct.id,
                            sku: 'CHAN-VAR-GREEN',
                            price: 3000,
                            optionIds: [createProductOption.id],
                            translations: [{ languageCode: LanguageCode.en, name: 'Green Variant' }],
                        },
                    ],
                });
            }, 'You are not currently authorized to perform this action'),
        );

        it('does not leave an orphaned variant after a permission-denied create', async () => {
            // The create above runs inside a @Transaction(), so the ForbiddenError thrown
            // by assignProductVariantsToChannel must roll back the whole operation — no
            // partially-created CHAN-VAR-GREEN variant should remain.
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: testProduct.id,
            });
            productGuard.assertSuccess(product);
            expect(product.variants.some(v => v.sku === 'CHAN-VAR-GREEN')).toBe(false);
        });

        afterAll(async () => {
            // Reset to super admin for subsequent test suites
            await adminClient.asSuperAdmin();
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });
    });

    describe('updating Product in sub-channel', () => {
        it(
            'throws if attempting to update a Product which is not assigned to that Channel',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(updateProductDocument, {
                    input: {
                        id: 'T_2',
                        translations: [{ languageCode: LanguageCode.en, name: 'xyz' }],
                    },
                });
            }, 'No Product with the id "2" could be found'),
        );
    });

    describe('updating channel defaultCurrencyCode', () => {
        let secondChannelId: string;
        const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
            input => !!input.id,
        );

        beforeAll(async () => {
            const { channels } = await adminClient.query(getChannelsDocument);
            const secondChannel = channels.items.find(c => c.token === SECOND_CHANNEL_TOKEN);
            if (!secondChannel) {
                throw new Error('Second channel not found');
            }
            secondChannelId = secondChannel.id;
        });

        it('updates variant prices from old default to new', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {});

            expect(productVariants.items.map(i => i.currencyCode)).toEqual(['GBP']);

            const { updateChannel } = await adminClient.query(updateChannelDocument, {
                input: {
                    id: secondChannelId,
                    availableCurrencyCodes: [CurrencyCode.MYR, CurrencyCode.GBP, CurrencyCode.EUR],
                    defaultCurrencyCode: CurrencyCode.MYR,
                },
            });

            channelGuard.assertSuccess(updateChannel);
            expect(updateChannel.defaultCurrencyCode).toBe(CurrencyCode.MYR);

            const { productVariants: variantsAfter } = await adminClient.query(
                getProductVariantListDocument,
                {},
            );

            expect(variantsAfter.items.map(i => i.currencyCode)).toEqual(['MYR']);
        });

        it('does not change prices in other currencies', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { productVariants } = await adminClient.query(getProductVariantListDocument, {});

            const { updateProductVariants } = await adminClient.query(updateProductVariantsDocument, {
                input: productVariants.items.map(i => ({
                    id: i.id,
                    prices: [
                        { price: 100, currencyCode: CurrencyCode.GBP },
                        { price: 200, currencyCode: CurrencyCode.MYR },
                        { price: 300, currencyCode: CurrencyCode.EUR },
                    ],
                })),
            });

            expect(updateProductVariants[0]?.prices.sort((a, b) => a.price - b.price)).toEqual([
                { currencyCode: 'GBP', price: 100 },
                { currencyCode: 'MYR', price: 200 },
                { currencyCode: 'EUR', price: 300 },
            ]);
            expect(updateProductVariants[0]?.currencyCode).toBe('MYR');

            await adminClient.query(updateChannelDocument, {
                input: {
                    id: secondChannelId,
                    availableCurrencyCodes: [
                        CurrencyCode.MYR,
                        CurrencyCode.GBP,
                        CurrencyCode.EUR,
                        CurrencyCode.AUD,
                    ],
                    defaultCurrencyCode: CurrencyCode.AUD,
                },
            });

            const { productVariants: after } = await adminClient.query(getProductVariantListDocument, {});

            expect(after.items.map(i => i.currencyCode)).toEqual(['AUD']);
            expect(after.items[0]?.prices.sort((a, b) => a.price - b.price)).toEqual([
                { currencyCode: 'GBP', price: 100 },
                { currencyCode: 'AUD', price: 200 },
                { currencyCode: 'EUR', price: 300 },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/2391
        it('does not duplicate an existing price', async () => {
            await adminClient.query(updateChannelDocument, {
                input: {
                    id: secondChannelId,
                    defaultCurrencyCode: CurrencyCode.GBP,
                },
            });

            const { productVariants: after } = await adminClient.query(getProductVariantListDocument, {});

            expect(after.items.map(i => i.currencyCode)).toEqual(['GBP']);
            expect(after.items[0]?.prices.sort((a, b) => a.price - b.price)).toEqual([
                { currencyCode: 'GBP', price: 100 },
                { currencyCode: 'AUD', price: 200 },
                { currencyCode: 'EUR', price: 300 },
            ]);
        });
    });

    describe('querying products', () => {
        // https://github.com/vendurehq/vendure/issues/2924
        it('find by slug with multiple channels', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

            const { createProduct: secondChannelProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel 2 Product',
                            slug: 'unique-slug',
                            description: 'Channel 2 product',
                        },
                    ],
                },
            });

            expect(secondChannelProduct.slug).toBe('unique-slug');

            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            const { createProduct: thirdChannelProduct } = await adminClient.query(createProductDocument, {
                input: {
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Channel 3 Product',
                            slug: 'unique-slug',
                            description: 'Channel 3 product',
                        },
                    ],
                },
            });

            expect(thirdChannelProduct.slug).toBe('unique-slug');

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { product: result1 } = await adminClient.query(getProductWithVariantsDocument, {
                slug: 'unique-slug',
            });
            expect(result1?.name).toBe('Channel 2 Product');

            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);
            const { product: result2 } = await adminClient.query(getProductWithVariantsDocument, {
                slug: 'unique-slug',
            });
            expect(result2?.name).toBe('Channel 3 Product');
        });
    });
});

const createProductOptionDocument = graphql(`
    mutation CreateProductOption($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
            code
            name
            groupId
        }
    }
`);

const getVariantStockLevelsDocument = graphql(`
    query GetVariantStockLevels($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            items {
                id
                stockLevels {
                    stockLocationId
                    stockOnHand
                    stockAllocated
                }
            }
        }
    }
`);

const getStockLocationsDocument = graphql(`
    query GetStockLocations {
        stockLocations {
            items {
                id
                name
            }
        }
    }
`);

const assignStockLocationToChannelDocument = graphql(`
    mutation AssignStockLocationToChannel($input: AssignStockLocationsToChannelInput!) {
        assignStockLocationsToChannel(input: $input) {
            id
            name
        }
    }
`);
