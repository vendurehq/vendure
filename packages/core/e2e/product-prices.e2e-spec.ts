/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { mergeConfig } from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { ProductVariantPrice, ProductVariantPriceUpdateStrategy, RequestContext } from '../src/index';

import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import {
    assignProductToChannelDocument,
    createChannelDocument,
    createProductDocument,
    createProductVariantsDocument,
    getProductWithVariantsDocument,
    updateChannelDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    adjustItemQuantityDocument,
    getActiveOrderDocument,
    testOrderFragment,
    updatedOrderFragment,
} from './graphql/shop-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

class TestProductVariantPriceUpdateStrategy implements ProductVariantPriceUpdateStrategy {
    static syncAcrossChannels = false;
    static onCreatedSpy = vi.fn();
    static onUpdatedSpy = vi.fn();
    static onDeletedSpy = vi.fn();

    onPriceCreated(ctx: RequestContext, price: ProductVariantPrice, prices: ProductVariantPrice[]) {
        TestProductVariantPriceUpdateStrategy.onCreatedSpy(price, prices);
        return [];
    }

    onPriceUpdated(ctx: RequestContext, updatedPrice: ProductVariantPrice, prices: ProductVariantPrice[]) {
        TestProductVariantPriceUpdateStrategy.onUpdatedSpy(updatedPrice, prices);
        if (TestProductVariantPriceUpdateStrategy.syncAcrossChannels) {
            return prices
                .filter(p => p.currencyCode === updatedPrice.currencyCode)
                .map(p => ({
                    id: p.id,
                    price: updatedPrice.price,
                }));
        } else {
            return [];
        }
    }

    onPriceDeleted(ctx: RequestContext, deletedPrice: ProductVariantPrice, prices: ProductVariantPrice[]) {
        TestProductVariantPriceUpdateStrategy.onDeletedSpy(deletedPrice, prices);
        return [];
    }
}

describe('Product prices', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(
            { ...testConfig() },
            {
                catalogOptions: {
                    productVariantPriceUpdateStrategy: new TestProductVariantPriceUpdateStrategy(),
                },
            },
        ),
    );

    let multiPriceProduct: ResultOf<typeof createProductDocument>['createProduct'];
    let multiPriceVariant: NonNullable<
        ResultOf<typeof createProductVariantsDocument>['createProductVariants'][number]
    >;

    const orderResultGuard: ErrorResultGuard<
        FragmentOf<typeof testOrderFragment> | FragmentOf<typeof updatedOrderFragment>
    > = createErrorResultGuard(input => !!input.lines);

    const createChannelResultGuard: ErrorResultGuard<{ id: string }> = createErrorResultGuard(
        input => !!input.id,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            customerCount: 1,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
        });
        await adminClient.asSuperAdmin();
        await adminClient.query(updateChannelDocument, {
            input: {
                id: 'T_1',
                availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.GBP, CurrencyCode.EUR],
            },
        });
        const { createProduct } = await adminClient.query(createProductDocument, {
            input: {
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Cactus',
                        slug: 'cactus',
                        description: 'A prickly plant',
                    },
                ],
            },
        });
        multiPriceProduct = createProduct;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('create ProductVariant creates price in Channel default currency', async () => {
        const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
            input: [
                {
                    productId: multiPriceProduct.id,
                    sku: 'CACTUS-1',
                    optionIds: [],
                    translations: [{ languageCode: LanguageCode.de, name: 'Cactus' }],
                    price: 1000,
                },
            ],
        });

        expect(createProductVariants.length).toBe(1);
        expect(createProductVariants[0]?.prices).toEqual([
            {
                currencyCode: CurrencyCode.USD,
                price: 1000,
            },
        ]);
        multiPriceVariant = createProductVariants[0]!;
    });

    it(
        'updating ProductVariant with price in unavailable currency throws',
        assertThrowsWithMessage(async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: {
                    id: multiPriceVariant.id,
                    prices: [
                        {
                            currencyCode: CurrencyCode.JPY,
                            price: 100000,
                        },
                    ],
                },
            });
        }, 'The currency "JPY" is not available in the current Channel'),
    );

    it('updates ProductVariant with multiple prices', async () => {
        await adminClient.query(updateProductVariantsDocument, {
            input: {
                id: multiPriceVariant.id,
                prices: [
                    { currencyCode: CurrencyCode.USD, price: 1200 },
                    { currencyCode: CurrencyCode.GBP, price: 900 },
                    { currencyCode: CurrencyCode.EUR, price: 1100 },
                ],
            },
        });

        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: multiPriceProduct.id,
        });

        expect(product?.variants[0]?.prices.sort((a, b) => a.price - b.price)).toEqual([
            { currencyCode: CurrencyCode.GBP, price: 900 },
            { currencyCode: CurrencyCode.EUR, price: 1100 },
            { currencyCode: CurrencyCode.USD, price: 1200 },
        ]);
    });

    it('deletes a price in a non-default currency', async () => {
        await adminClient.query(updateProductVariantsDocument, {
            input: {
                id: multiPriceVariant.id,
                prices: [{ currencyCode: CurrencyCode.EUR, price: 1100, delete: true }],
            },
        });

        const { product } = await adminClient.query(getProductWithVariantsDocument, {
            id: multiPriceProduct.id,
        });

        expect(product?.variants[0]?.prices.sort((a, b) => a.price - b.price)).toEqual([
            { currencyCode: CurrencyCode.GBP, price: 900 },
            { currencyCode: CurrencyCode.USD, price: 1200 },
        ]);
    });

    describe('DefaultProductVariantPriceSelectionStrategy', () => {
        it('defaults to default Channel currency', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: multiPriceProduct.id,
            });

            expect(product?.variants[0]?.price).toEqual(1200);
            expect(product?.variants[0]?.priceWithTax).toEqual(1200 * 1.2);
            expect(product?.variants[0]?.currencyCode).toEqual(CurrencyCode.USD);
        });

        it('uses query string to select currency', async () => {
            const { product } = await adminClient.query(
                getProductWithVariantsDocument,
                {
                    id: multiPriceProduct.id,
                },
                { currencyCode: 'GBP' },
            );

            expect(product?.variants[0]?.price).toEqual(900);
            expect(product?.variants[0]?.priceWithTax).toEqual(900 * 1.2);
            expect(product?.variants[0]?.currencyCode).toEqual(CurrencyCode.GBP);
        });

        it(
            'throws if unrecognised currency code passed in query string',
            assertThrowsWithMessage(async () => {
                await adminClient.query(
                    getProductWithVariantsDocument,
                    {
                        id: multiPriceProduct.id,
                    },
                    { currencyCode: 'JPY' },
                );
            }, 'The currency "JPY" is not available in the current Channel'),
        );
    });

    describe('changing Order currencyCode', () => {
        beforeAll(async () => {
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_1',
                        prices: [
                            { currencyCode: CurrencyCode.USD, price: 1000 },
                            { currencyCode: CurrencyCode.GBP, price: 900 },
                            { currencyCode: CurrencyCode.EUR, price: 1100 },
                        ],
                    },
                    {
                        id: 'T_2',
                        prices: [
                            { currencyCode: CurrencyCode.USD, price: 2000 },
                            { currencyCode: CurrencyCode.GBP, price: 1900 },
                            { currencyCode: CurrencyCode.EUR, price: 2100 },
                        ],
                    },
                    {
                        id: 'T_3',
                        prices: [
                            { currencyCode: CurrencyCode.USD, price: 3000 },
                            { currencyCode: CurrencyCode.GBP, price: 2900 },
                            { currencyCode: CurrencyCode.EUR, price: 3100 },
                        ],
                    },
                ],
            });
        });

        it('create order in default currency', async () => {
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: 'T_2',
                quantity: 1,
            });

            const { activeOrder } = await shopClient.query(getActiveOrderDocument);

            expect(activeOrder?.lines[0]?.unitPrice).toBe(1000);
            expect(activeOrder?.lines[0]?.unitPriceWithTax).toBe(1200);
            expect(activeOrder?.lines[1]?.unitPrice).toBe(2000);
            expect(activeOrder?.lines[1]?.unitPriceWithTax).toBe(2400);
            expect(activeOrder?.currencyCode).toBe(CurrencyCode.USD);
        });

        it(
            'updating an order in an unsupported currency throws',
            assertThrowsWithMessage(async () => {
                await shopClient.query(
                    addItemToOrderDocument,
                    {
                        productVariantId: 'T_1',
                        quantity: 1,
                    },
                    { currencyCode: 'JPY' },
                );
            }, 'The currency "JPY" is not available in the current Channel'),
        );

        it('updating an order line with a new currency updates all lines to that currency', async () => {
            const { activeOrder } = await shopClient.query(getActiveOrderDocument);
            const { adjustOrderLine } = await shopClient.query(
                adjustItemQuantityDocument,
                {
                    orderLineId: activeOrder!.lines[0]?.id,
                    quantity: 2,
                },
                { currencyCode: 'GBP' },
            );

            orderResultGuard.assertSuccess(adjustOrderLine);

            expect(adjustOrderLine?.lines[0]?.unitPrice).toBe(900);
            expect(adjustOrderLine?.lines[0]?.unitPriceWithTax).toBe(1080);
            expect(adjustOrderLine?.lines[1]?.unitPrice).toBe(1900);
            expect(adjustOrderLine?.lines[1]?.unitPriceWithTax).toBe(2280);
            expect(adjustOrderLine.currencyCode).toBe('GBP');
        });

        it('adding a new order line with a new currency updates all lines to that currency', async () => {
            const { addItemToOrder } = await shopClient.query(
                addItemToOrderDocument,
                {
                    productVariantId: 'T_3',
                    quantity: 1,
                },
                { currencyCode: 'EUR' },
            );

            orderResultGuard.assertSuccess(addItemToOrder);

            expect(addItemToOrder?.lines[0]?.unitPrice).toBe(1100);
            expect(addItemToOrder?.lines[0]?.unitPriceWithTax).toBe(1320);
            expect(addItemToOrder?.lines[1]?.unitPrice).toBe(2100);
            expect(addItemToOrder?.lines[1]?.unitPriceWithTax).toBe(2520);
            expect(addItemToOrder?.lines[2]?.unitPrice).toBe(3100);
            expect(addItemToOrder?.lines[2]?.unitPriceWithTax).toBe(3720);
            expect(addItemToOrder.currencyCode).toBe('EUR');
        });
    });

    describe('ProductVariantPriceUpdateStrategy', () => {
        const SECOND_CHANNEL_TOKEN = 'second_channel_token';
        const THIRD_CHANNEL_TOKEN = 'third_channel_token';
        beforeAll(async () => {
            const { createChannel: channel2Result } = await adminClient.query(createChannelDocument, {
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
            createChannelResultGuard.assertSuccess(channel2Result);

            const { createChannel: channel3Result } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'third-channel',
                    token: THIRD_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            createChannelResultGuard.assertSuccess(channel3Result);

            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: channel2Result.id,
                    productIds: [multiPriceProduct.id],
                },
            });

            await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: channel3Result.id,
                    productIds: [multiPriceProduct.id],
                },
            });
        });

        it('onPriceCreated() is called when a new price is created', async () => {
            await adminClient.asSuperAdmin();
            const onCreatedSpy = TestProductVariantPriceUpdateStrategy.onCreatedSpy;
            onCreatedSpy.mockClear();
            await adminClient.query(updateChannelDocument, {
                input: {
                    id: 'T_1',
                    availableCurrencyCodes: [
                        CurrencyCode.USD,
                        CurrencyCode.GBP,
                        CurrencyCode.EUR,
                        CurrencyCode.MYR,
                    ],
                },
            });
            await adminClient.query(updateProductVariantsDocument, {
                input: {
                    id: multiPriceVariant.id,
                    prices: [{ currencyCode: CurrencyCode.MYR, price: 5500 }],
                },
            });

            expect(onCreatedSpy).toHaveBeenCalledTimes(1);
            expect(onCreatedSpy.mock.calls[0][0].currencyCode).toBe(CurrencyCode.MYR);
            expect(onCreatedSpy.mock.calls[0][0].price).toBe(5500);
            expect(onCreatedSpy.mock.calls[0][1].length).toBe(4);
            expect(getOrderedPricesArray(onCreatedSpy.mock.calls[0][1])).toEqual([
                {
                    channelId: 1,
                    currencyCode: 'USD',
                    id: 35,
                    price: 1200,
                },
                {
                    channelId: 1,
                    currencyCode: 'GBP',
                    id: 36,
                    price: 900,
                },
                {
                    channelId: 2,
                    currencyCode: 'GBP',
                    id: 44,
                    price: 1440,
                },
                {
                    channelId: 3,
                    currencyCode: 'GBP',
                    id: 45,
                    price: 1440,
                },
            ]);
        });

        it('onPriceUpdated() is called when a new price is created', async () => {
            adminClient.setChannelToken(THIRD_CHANNEL_TOKEN);

            TestProductVariantPriceUpdateStrategy.syncAcrossChannels = true;
            const onUpdatedSpy = TestProductVariantPriceUpdateStrategy.onUpdatedSpy;
            onUpdatedSpy.mockClear();

            await adminClient.query(updateProductVariantsDocument, {
                input: {
                    id: multiPriceVariant.id,
                    prices: [
                        {
                            currencyCode: CurrencyCode.GBP,
                            price: 4242,
                        },
                    ],
                },
            });

            expect(onUpdatedSpy).toHaveBeenCalledTimes(1);
            expect(onUpdatedSpy.mock.calls[0][0].currencyCode).toBe(CurrencyCode.GBP);
            expect(onUpdatedSpy.mock.calls[0][0].price).toBe(4242);
            expect(onUpdatedSpy.mock.calls[0][1].length).toBe(5);
            expect(getOrderedPricesArray(onUpdatedSpy.mock.calls[0][1])).toEqual([
                {
                    channelId: 1,
                    currencyCode: 'USD',
                    id: 35,
                    price: 1200,
                },
                {
                    channelId: 1,
                    currencyCode: 'GBP',
                    id: 36,
                    price: 900,
                },
                {
                    channelId: 2,
                    currencyCode: 'GBP',
                    id: 44,
                    price: 1440,
                },
                {
                    channelId: 3,
                    currencyCode: 'GBP',
                    id: 45,
                    price: 4242,
                },
                {
                    channelId: 1,
                    currencyCode: 'MYR',
                    id: 46,
                    price: 5500,
                },
            ]);
        });

        it('syncing prices in other channels', async () => {
            const { product: productChannel3 } = await adminClient.query(getProductWithVariantsDocument, {
                id: multiPriceProduct.id,
            });
            expect(productChannel3?.variants[0].prices).toEqual([
                { currencyCode: CurrencyCode.GBP, price: 4242 },
            ]);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { product: productChannel2 } = await adminClient.query(getProductWithVariantsDocument, {
                id: multiPriceProduct.id,
            });
            expect(productChannel2?.variants[0].prices).toEqual([
                { currencyCode: CurrencyCode.GBP, price: 4242 },
            ]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: productDefaultChannel } = await adminClient.query(
                getProductWithVariantsDocument,
                {
                    id: multiPriceProduct.id,
                },
            );
            expect(productDefaultChannel?.variants[0].prices).toEqual([
                { currencyCode: CurrencyCode.USD, price: 1200 },
                { currencyCode: CurrencyCode.GBP, price: 4242 },
                { currencyCode: CurrencyCode.MYR, price: 5500 },
            ]);
        });

        it('onPriceDeleted() is called when a price is deleted', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const onDeletedSpy = TestProductVariantPriceUpdateStrategy.onDeletedSpy;
            onDeletedSpy.mockClear();

            const result = await adminClient.query(updateProductVariantsDocument, {
                input: {
                    id: multiPriceVariant.id,
                    prices: [
                        {
                            currencyCode: CurrencyCode.MYR,
                            price: 4242,
                            delete: true,
                        },
                    ],
                },
            });

            expect(result.updateProductVariants[0]?.prices).toEqual([
                { currencyCode: CurrencyCode.USD, price: 1200 },
                { currencyCode: CurrencyCode.GBP, price: 4242 },
            ]);

            expect(onDeletedSpy).toHaveBeenCalledTimes(1);
            expect(onDeletedSpy.mock.calls[0][0].currencyCode).toBe(CurrencyCode.MYR);
            expect(onDeletedSpy.mock.calls[0][0].price).toBe(5500);
            expect(onDeletedSpy.mock.calls[0][1].length).toBe(4);
            expect(getOrderedPricesArray(onDeletedSpy.mock.calls[0][1])).toEqual([
                {
                    channelId: 1,
                    currencyCode: 'USD',
                    id: 35,
                    price: 1200,
                },
                {
                    channelId: 1,
                    currencyCode: 'GBP',
                    id: 36,
                    price: 4242,
                },
                {
                    channelId: 2,
                    currencyCode: 'GBP',
                    id: 44,
                    price: 4242,
                },
                {
                    channelId: 3,
                    currencyCode: 'GBP',
                    id: 45,
                    price: 4242,
                },
            ]);
        });
    });
});

function getOrderedPricesArray(input: ProductVariantPrice[]) {
    return input
        .map(p => pick(p, ['channelId', 'currencyCode', 'price', 'id']))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
}
