import { CurrencyCode, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { FacetService, FacetValueService, RequestContextService } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment, facetWithValuesFragment } from './graphql/fragments-admin';
import { FragmentOf, ResultOf } from './graphql/graphql-admin';
import {
    assignFacetsToChannelDocument,
    assignProductToChannelDocument,
    createChannelDocument,
    createFacetDocument,
    createFacetValueDocument,
    createFacetValuesDocument,
    deleteFacetDocument,
    deleteFacetValuesDocument,
    getFacetListDocument,
    getFacetListSimpleDocument,
    getFacetValueDocument,
    getFacetValuesDocument,
    getFacetWithValueListDocument,
    getFacetWithValuesDocument,
    getProductsListWithVariantsDocument,
    getProductWithFacetValuesDocument,
    getProductWithVariantsDocument,
    removeFacetsFromChannelDocument,
    updateFacetDocument,
    updateFacetValueDocument,
    updateFacetValuesDocument,
    updateGlobalSettingsDocument,
    updateProductDocument,
    updateProductVariantsDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

describe('Facet resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());

    let brandFacet: FragmentOf<typeof facetWithValuesFragment>;
    let speakerTypeFacet: FragmentOf<typeof facetWithValuesFragment>;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('createFacet', async () => {
        const result = await adminClient.query(createFacetDocument, {
            input: {
                isPrivate: false,
                code: 'speaker-type',
                translations: [{ languageCode: LanguageCode.en, name: 'Speaker Type' }],
                values: [
                    {
                        code: 'portable',
                        translations: [{ languageCode: LanguageCode.en, name: 'Portable' }],
                    },
                ],
            },
        });

        speakerTypeFacet = result.createFacet;
        expect(speakerTypeFacet).toMatchSnapshot();
    });

    it('updateFacet', async () => {
        const result = await adminClient.query(updateFacetDocument, {
            input: {
                id: speakerTypeFacet.id,
                translations: [{ languageCode: LanguageCode.en, name: 'Speaker Category' }],
                isPrivate: true,
            },
        });

        expect(result.updateFacet.name).toBe('Speaker Category');
    });

    it('createFacetValues', async () => {
        const { createFacetValues } = await adminClient.query(createFacetValuesDocument, {
            input: [
                {
                    facetId: speakerTypeFacet.id,
                    code: 'pc',
                    translations: [{ languageCode: LanguageCode.en, name: 'PC Speakers' }],
                },
                {
                    facetId: speakerTypeFacet.id,
                    code: 'hi-fi',
                    translations: [{ languageCode: LanguageCode.en, name: 'Hi Fi Speakers' }],
                },
            ],
        });

        expect(createFacetValues.length).toBe(2);
        expect(pick(createFacetValues.find(fv => fv.code === 'pc')!, ['code', 'facet', 'name'])).toEqual({
            code: 'pc',
            facet: {
                id: 'T_2',
                name: 'Speaker Category',
            },
            name: 'PC Speakers',
        });
        expect(pick(createFacetValues.find(fv => fv.code === 'hi-fi')!, ['code', 'facet', 'name'])).toEqual({
            code: 'hi-fi',
            facet: {
                id: 'T_2',
                name: 'Speaker Category',
            },
            name: 'Hi Fi Speakers',
        });
    });

    it('updateFacetValues', async () => {
        const portableFacetValue = speakerTypeFacet.values.find(v => v.code === 'portable')!;
        const result = await adminClient.query(updateFacetValuesDocument, {
            input: [
                {
                    id: portableFacetValue.id,
                    code: 'compact',
                },
            ],
        });

        expect(result.updateFacetValues[0].code).toBe('compact');
    });

    it('createFacetValue (single)', async () => {
        const result = await adminClient.query(createFacetValueDocument, {
            input: {
                facetId: speakerTypeFacet.id,
                code: 'wireless',
                translations: [{ languageCode: LanguageCode.en, name: 'Wireless Speakers' }],
            },
        });

        expect(result.createFacetValue).toEqual({
            id: expect.any(String),
            code: 'wireless',
            name: 'Wireless Speakers',
            languageCode: 'en',
            facet: {
                id: speakerTypeFacet.id,
                name: 'Speaker Category',
            },
            translations: [
                {
                    id: expect.any(String),
                    languageCode: LanguageCode.en,
                    name: 'Wireless Speakers',
                },
            ],
        });
    });

    it('updateFacetValue (single)', async () => {
        // First get the newly created facet value
        const facetWithValues = await adminClient.query(getFacetWithValuesDocument, {
            id: speakerTypeFacet.id,
        });

        const wirelessFacetValue = facetWithValues.facet!.values.find(v => v.code === 'wireless')!;

        const result = await adminClient.query(updateFacetValueDocument, {
            input: {
                id: wirelessFacetValue.id,
                code: 'bluetooth',
                translations: [
                    {
                        id: wirelessFacetValue.translations[0].id,
                        languageCode: LanguageCode.en,
                        name: 'Bluetooth Speakers',
                    },
                ],
            },
        });

        expect(result.updateFacetValue).toEqual({
            id: wirelessFacetValue.id,
            code: 'bluetooth',
            name: 'Bluetooth Speakers',
            languageCode: 'en',
            facet: {
                id: speakerTypeFacet.id,
                name: 'Speaker Category',
            },
            translations: [
                {
                    id: expect.any(String),
                    languageCode: LanguageCode.en,
                    name: 'Bluetooth Speakers',
                },
            ],
        });
    });

    it('facets', async () => {
        const result = await adminClient.query(getFacetListDocument);

        const { items } = result.facets;
        expect(items.length).toBe(2);
        expect(items[0].name).toBe('category');
        expect(items[1].name).toBe('Speaker Category');

        brandFacet = items[0];
        speakerTypeFacet = items[1];
    });

    it('facets by shop-api', async () => {
        const result = await shopClient.query(getFacetListSimpleDocument);

        const { items } = result.facets;
        expect(items.length).toBe(1);
        expect(items[0].name).toBe('category');
    });

    it('facet', async () => {
        const result = await adminClient.query(getFacetWithValuesDocument, {
            id: speakerTypeFacet.id,
        });

        expect(result.facet!.name).toBe('Speaker Category');
    });

    it('facet with valueList', async () => {
        const result = await adminClient.query(getFacetWithValueListDocument, {
            id: speakerTypeFacet.id,
        });
        expect(result.facet?.valueList.totalItems).toBe(4);
    });

    it('facet with valueList with name filter', async () => {
        const result = await adminClient.query(getFacetWithValueListDocument, {
            id: speakerTypeFacet.id,
            options: {
                filter: {
                    name: {
                        contains: 'spea',
                    },
                },
            },
        });
        expect(result.facet?.valueList.totalItems).toBe(3);
    });

    it('facetValues list query', async () => {
        const result = await adminClient.query(getFacetValuesDocument, {
            options: {
                filter: {
                    facetId: { eq: speakerTypeFacet.id },
                },
            },
        });

        expect(result.facetValues.totalItems).toBe(4);
        expect(result.facetValues.items.length).toBe(4);
        expect(result.facetValues.items.map(v => v.code).sort()).toEqual([
            'bluetooth',
            'compact',
            'hi-fi',
            'pc',
        ]);
        expect(result.facetValues.items.every(v => v.facet.id === speakerTypeFacet.id)).toBe(true);
    });

    it('facetValue single query', async () => {
        const pcFacetValue = speakerTypeFacet.values.find(v => v.code === 'pc')!;
        const result = await adminClient.query(getFacetValueDocument, {
            id: pcFacetValue.id,
        });

        expect(result.facetValue).toBeDefined();
        expect(result.facetValue!.id).toBe(pcFacetValue.id);
        expect(result.facetValue!.code).toBe('pc');
        expect(result.facetValue!.name).toBe('PC Speakers');
        expect(result.facetValue!.facet.id).toBe(speakerTypeFacet.id);
        expect(result.facetValue!.facet.name).toBe('Speaker Category');
    });

    it('product.facetValues resolver omits private facets in shop-api', async () => {
        const publicFacetValue = brandFacet.values[0];
        const privateFacetValue = speakerTypeFacet.values[0];
        await adminClient.query(updateProductDocument, {
            input: {
                id: 'T_1',
                facetValueIds: [publicFacetValue.id, privateFacetValue.id],
            },
        });
        const { product } = await shopClient.query(getProductWithFacetValuesDocument, {
            id: 'T_1',
        });

        expect(product?.facetValues.map(v => v.id).includes(publicFacetValue.id)).toBe(true);
        expect(product?.facetValues.map(v => v.id).includes(privateFacetValue.id)).toBe(false);
    });

    it('productVariant.facetValues resolver omits private facets in shop-api', async () => {
        const publicFacetValue = brandFacet.values[0];
        const privateFacetValue = speakerTypeFacet.values[0];
        await adminClient.query(updateProductVariantsDocument, {
            input: [
                {
                    id: 'T_1',
                    facetValueIds: [publicFacetValue.id, privateFacetValue.id],
                },
            ],
        });
        const { product } = await shopClient.query(getProductWithFacetValuesDocument, {
            id: 'T_1',
        });

        const productVariant1 = product?.variants.find(v => v.id === 'T_1');
        expect(productVariant1?.facetValues.map(v => v.id).includes(publicFacetValue.id)).toBe(true);
        expect(productVariant1?.facetValues.map(v => v.id).includes(privateFacetValue.id)).toBe(false);
    });

    describe('deletion', () => {
        let products: ResultOf<typeof getProductsListWithVariantsDocument>['products']['items'];

        beforeAll(async () => {
            // add the FacetValues to products and variants
            const result1 = await adminClient.query(getProductsListWithVariantsDocument);
            products = result1.products.items;
            const pcFacetValue = speakerTypeFacet.values.find(v => v.code === 'pc')!;
            const hifiFacetValue = speakerTypeFacet.values.find(v => v.code === 'hi-fi')!;

            await adminClient.query(updateProductDocument, {
                input: {
                    id: products[0].id,
                    facetValueIds: [pcFacetValue.id],
                },
            });

            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: products[0].variants[0].id,
                        facetValueIds: [pcFacetValue.id],
                    },
                ],
            });

            await adminClient.query(updateProductDocument, {
                input: {
                    id: products[1].id,
                    facetValueIds: [hifiFacetValue.id],
                },
            });
        });

        it('deleteFacetValues deletes unused facetValue', async () => {
            const facetValueToDelete = speakerTypeFacet.values.find(v => v.code === 'compact')!;
            const result1 = await adminClient.query(deleteFacetValuesDocument, {
                ids: [facetValueToDelete.id],
                force: false,
            });
            const result2 = await adminClient.query(getFacetWithValuesDocument, {
                id: speakerTypeFacet.id,
            });

            expect(result1.deleteFacetValues).toEqual([
                {
                    result: DeletionResult.DELETED,
                    message: '',
                },
            ]);

            expect(result2.facet!.values[0]).not.toEqual(facetValueToDelete);
        });

        it('deleteFacetValues for FacetValue in use returns NOT_DELETED', async () => {
            const facetValueToDelete = speakerTypeFacet.values.find(v => v.code === 'pc')!;
            const result1 = await adminClient.query(deleteFacetValuesDocument, {
                ids: [facetValueToDelete.id],
                force: false,
            });
            const result2 = await adminClient.query(getFacetWithValuesDocument, {
                id: speakerTypeFacet.id,
            });

            expect(result1.deleteFacetValues).toEqual([
                {
                    result: DeletionResult.NOT_DELETED,
                    message: 'The FacetValue "pc" is assigned to 1 Product, 1 ProductVariant',
                },
            ]);

            expect(result2.facet!.values.find(v => v.id === facetValueToDelete.id)).toBeDefined();
        });

        it('deleteFacetValues for FacetValue in use can be force deleted', async () => {
            const facetValueToDelete = speakerTypeFacet.values.find(v => v.code === 'pc')!;
            const result1 = await adminClient.query(deleteFacetValuesDocument, {
                ids: [facetValueToDelete.id],
                force: true,
            });

            expect(result1.deleteFacetValues).toEqual([
                {
                    result: DeletionResult.DELETED,
                    message:
                        'The selected FacetValue was removed from 1 Product, 1 ProductVariant and deleted',
                },
            ]);

            // FacetValue no longer in the Facet.values array
            const result2 = await adminClient.query(getFacetWithValuesDocument, {
                id: speakerTypeFacet.id,
            });
            expect(result2.facet!.values[0]).not.toEqual(facetValueToDelete);

            // FacetValue no longer in the Product.facetValues array
            const result3 = await adminClient.query(getProductWithVariantsDocument, {
                id: products[0].id,
            });
            expect(result3.product!.facetValues).toEqual([]);
        });

        it('deleteFacet that is in use returns NOT_DELETED', async () => {
            const result1 = await adminClient.query(deleteFacetDocument, {
                id: speakerTypeFacet.id,
                force: false,
            });
            const result2 = await adminClient.query(getFacetWithValuesDocument, {
                id: speakerTypeFacet.id,
            });

            expect(result1.deleteFacet).toEqual({
                result: DeletionResult.NOT_DELETED,
                message: 'The Facet "speaker-type" includes FacetValues which are assigned to 1 Product',
            });

            expect(result2.facet).not.toBe(null);
        });

        it('deleteFacet that is in use can be force deleted', async () => {
            const result1 = await adminClient.query(deleteFacetDocument, {
                id: speakerTypeFacet.id,
                force: true,
            });

            expect(result1.deleteFacet).toEqual({
                result: DeletionResult.DELETED,
                message: 'The Facet was deleted and its FacetValues were removed from 1 Product',
            });

            // FacetValue no longer in the Facet.values array
            const result2 = await adminClient.query(getFacetWithValuesDocument, {
                id: speakerTypeFacet.id,
            });
            expect(result2.facet).toBe(null);

            // FacetValue no longer in the Product.facetValues array
            const result3 = await adminClient.query(getProductWithVariantsDocument, {
                id: products[1].id,
            });
            expect(result3.product!.facetValues).toEqual([]);
        });

        it('deleteFacet with no FacetValues works', async () => {
            const { createFacet } = await adminClient.query(createFacetDocument, {
                input: {
                    code: 'test',
                    isPrivate: false,
                    translations: [{ languageCode: LanguageCode.en, name: 'Test' }],
                },
            });
            const result = await adminClient.query(deleteFacetDocument, {
                id: createFacet.id,
                force: false,
            });
            expect(result.deleteFacet.result).toBe(DeletionResult.DELETED);
        });
    });

    describe('channels', () => {
        const SECOND_CHANNEL_TOKEN = 'second_channel_token';
        let secondChannel: FragmentOf<typeof channelFragment>;
        let createdFacet: ResultOf<typeof createFacetDocument>['createFacet'];

        beforeAll(async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.USD,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });

            secondChannel = createChannel as FragmentOf<typeof channelFragment>;

            const { assignProductsToChannel } = await adminClient.query(assignProductToChannelDocument, {
                input: {
                    channelId: secondChannel.id,
                    productIds: ['T_1'],
                    priceFactor: 0.5,
                },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        });

        it('create Facet in channel', async () => {
            const { createFacet } = await adminClient.query(createFacetDocument, {
                input: {
                    isPrivate: false,
                    code: 'channel-facet',
                    translations: [{ languageCode: LanguageCode.en, name: 'Channel Facet' }],
                    values: [
                        {
                            code: 'channel-value-1',
                            translations: [{ languageCode: LanguageCode.en, name: 'Channel Value 1' }],
                        },
                        {
                            code: 'channel-value-2',
                            translations: [{ languageCode: LanguageCode.en, name: 'Channel Value 2' }],
                        },
                    ],
                },
            });

            expect(createFacet.code).toBe('channel-facet');

            createdFacet = createFacet;
        });

        it('facets list in channel', async () => {
            const result = await adminClient.query(getFacetListDocument);

            const { items } = result.facets;
            expect(items.length).toBe(1);
            expect(items.map(i => i.code)).toEqual(['channel-facet']);
        });

        it('Product.facetValues in channel', async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.query(updateProductDocument, {
                input: {
                    id: 'T_1',
                    facetValueIds: [brandFacet.values[0].id, ...createdFacet.values.map(v => v.id)],
                },
            });
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_1',
                        facetValueIds: [brandFacet.values[0].id, ...createdFacet.values.map(v => v.id)],
                    },
                ],
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            expect(product?.facetValues.map(fv => fv.code).sort()).toEqual([
                'channel-value-1',
                'channel-value-2',
            ]);
        });

        it('ProductVariant.facetValues in channel', async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            expect(product?.variants[0].facetValues.map(fv => fv.code).sort()).toEqual([
                'channel-value-1',
                'channel-value-2',
            ]);
        });

        it('updating Product facetValuesIds in channel only affects that channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(updateProductDocument, {
                input: {
                    id: 'T_1',
                    facetValueIds: [createdFacet.values[0].id],
                },
            });

            const { product: productC2 } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            expect(productC2?.facetValues.map(fv => fv.code)).toEqual([createdFacet.values[0].code]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: productCD } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            expect(productCD?.facetValues.map(fv => fv.code)).toEqual([
                brandFacet.values[0].code,
                createdFacet.values[0].code,
            ]);
        });

        it('updating ProductVariant facetValuesIds in channel only affects that channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(updateProductVariantsDocument, {
                input: [
                    {
                        id: 'T_1',
                        facetValueIds: [createdFacet.values[0].id],
                    },
                ],
            });

            const { product: productC2 } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            expect(productC2?.variants.find(v => v.id === 'T_1')?.facetValues.map(fv => fv.code)).toEqual([
                createdFacet.values[0].code,
            ]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { product: productCD } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            expect(productCD?.variants.find(v => v.id === 'T_1')?.facetValues.map(fv => fv.code)).toEqual([
                brandFacet.values[0].code,
                createdFacet.values[0].code,
            ]);
        });

        it(
            'attempting to create FacetValue in Facet from another Channel throws',
            assertThrowsWithMessage(async () => {
                adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
                await adminClient.query(createFacetValuesDocument, {
                    input: [
                        {
                            facetId: brandFacet.id,
                            code: 'channel-brand',
                            translations: [{ languageCode: LanguageCode.en, name: 'Channel Brand' }],
                        },
                    ],
                });
            }, 'No Facet with the id "1" could be found'),
        );

        it('removing from channel with error', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { facets: before } = await adminClient.query(getFacetListSimpleDocument);
            expect(before.items).toEqual([{ id: 'T_4', name: 'Channel Facet' }]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removeFacetsFromChannel } = await adminClient.query(removeFacetsFromChannelDocument, {
                input: {
                    channelId: secondChannel.id,
                    facetIds: [createdFacet.id],
                    force: false,
                },
            });

            expect(removeFacetsFromChannel).toEqual([
                {
                    errorCode: 'FACET_IN_USE_ERROR',
                    message:
                        'The Facet "channel-facet" includes FacetValues which are assigned to 1 Product 1 ProductVariant',
                    productCount: 1,
                    variantCount: 1,
                },
            ]);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { facets: after } = await adminClient.query(getFacetListSimpleDocument);
            expect(after.items).toEqual([{ id: 'T_4', name: 'Channel Facet' }]);
        });

        it('force removing from channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { facets: before } = await adminClient.query(getFacetListSimpleDocument);
            expect(before.items).toEqual([{ id: 'T_4', name: 'Channel Facet' }]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { removeFacetsFromChannel } = await adminClient.query(removeFacetsFromChannelDocument, {
                input: {
                    channelId: secondChannel.id,
                    facetIds: [createdFacet.id],
                    force: true,
                },
            });

            expect(removeFacetsFromChannel).toEqual([{ id: 'T_4', name: 'Channel Facet' }]);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { facets: after } = await adminClient.query(getFacetListSimpleDocument);
            expect(after.items).toEqual([]);
        });

        it('assigning to channel', async () => {
            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { facets: before } = await adminClient.query(getFacetListSimpleDocument);
            expect(before.items).toEqual([]);

            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            const { assignFacetsToChannel } = await adminClient.query(assignFacetsToChannelDocument, {
                input: {
                    channelId: secondChannel.id,
                    facetIds: [createdFacet.id],
                },
            });

            expect(assignFacetsToChannel).toEqual([{ id: 'T_4', name: 'Channel Facet' }]);

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            const { facets: after } = await adminClient.query(getFacetListSimpleDocument);
            expect(after.items).toEqual([{ id: 'T_4', name: 'Channel Facet' }]);
        });
    });

    // https://github.com/vendurehq/vendure/issues/715
    describe('code conflicts', () => {
        function createFacetWithCode(code: string) {
            return adminClient.query(createFacetDocument, {
                input: {
                    isPrivate: false,
                    code,
                    translations: [{ languageCode: LanguageCode.en, name: `Test Facet (${code})` }],
                    values: [],
                },
            });
        }

        // https://github.com/vendurehq/vendure/issues/831
        it('updateFacet with unchanged code', async () => {
            const { createFacet } = await createFacetWithCode('some-new-facet');
            const result = await adminClient.query(updateFacetDocument, {
                input: {
                    id: createFacet.id,
                    code: createFacet.code,
                },
            });

            expect(result.updateFacet.code).toBe(createFacet.code);
        });

        it('createFacet with conflicting slug gets renamed', async () => {
            const { createFacet: result1 } = await createFacetWithCode('test');
            expect(result1.code).toBe('test');

            const { createFacet: result2 } = await createFacetWithCode('test');
            expect(result2.code).toBe('test-2');
        });

        it('updateFacet with conflicting slug gets renamed', async () => {
            const { createFacet } = await createFacetWithCode('foo');
            expect(createFacet.code).toBe('foo');

            const { updateFacet } = await adminClient.query(updateFacetDocument, {
                input: {
                    id: createFacet.id,
                    code: 'test-2',
                },
            });

            expect(updateFacet.code).toBe('test-3');
        });
    });

    describe('cross-channel update protection', () => {
        const CHANNEL_A_TOKEN = 'facet-cross-channel-a';
        const CHANNEL_B_TOKEN = 'facet-cross-channel-b';
        let facetId: string;
        let valueId: string;

        beforeAll(async () => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            for (const [code, token] of [
                ['facet-cross-a', CHANNEL_A_TOKEN],
                ['facet-cross-b', CHANNEL_B_TOKEN],
            ]) {
                await adminClient.query(createChannelDocument, {
                    input: {
                        code,
                        token,
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: CurrencyCode.USD,
                        pricesIncludeTax: true,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                });
            }
            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            const { createFacet } = await adminClient.query(createFacetDocument, {
                input: {
                    isPrivate: false,
                    code: 'cross-channel-facet',
                    translations: [{ languageCode: LanguageCode.en, name: 'Cross Channel Facet' }],
                    values: [
                        {
                            code: 'cross-channel-value',
                            translations: [{ languageCode: LanguageCode.en, name: 'Original Value' }],
                        },
                    ],
                },
            });
            facetId = createFacet.id;
            valueId = createFacet.values[0].id;
        });

        afterAll(() => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        it('cannot update a FacetValue belonging to another channel', async () => {
            // channel-b does not contain this value, so the update must be rejected.
            adminClient.setChannelToken(CHANNEL_B_TOKEN);
            await expect(
                adminClient.query(updateFacetValueDocument, {
                    input: {
                        id: valueId,
                        translations: [{ languageCode: LanguageCode.en, name: 'Updated Value' }],
                    },
                }),
            ).rejects.toThrow(/No FacetValue with the id .* could be found/);

            adminClient.setChannelToken(CHANNEL_A_TOKEN);
            const { facet } = await adminClient.query(getFacetWithValuesDocument, { id: facetId });
            const value = facet?.values.find(v => v.id === valueId);
            expect(value?.name).toBe('Original Value');
        });
    });
});

/**
 * Tests the language fallback behaviour of FacetService.findByCode() and
 * FacetValueService.findAll() when a channel has a non-English defaultLanguageCode.
 *
 * Regression test for the bug where both methods passed only a single LanguageCode
 * to translateDeep() instead of a fallback array, ignoring ctx.channel.defaultLanguageCode.
 *
 * @see packages/core/src/service/services/facet.service.ts
 * @see packages/core/src/service/services/facet-value.service.ts
 */
describe('Facet translation language fallback', () => {
    const SECOND_CHANNEL_TOKEN = 'facet-translation-test-channel';
    const { server, adminClient } = createTestEnvironment(testConfig());

    /**
     * Set up:
     * - German (de) added to global available languages
     * - A second channel whose defaultLanguageCode is German (de)
     * - A facet with both EN and DE translations (but NO French translation)
     *
     * The tests then query via a RequestContext with languageCode = fr (French).
     * Expected: German is returned as the channel-default fallback.
     * Before fix: English would be returned (system DEFAULT_LANGUAGE_CODE fallback).
     */
    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();

        // Add German to global available languages so the channel creation is valid
        await adminClient.query(updateGlobalSettingsDocument, {
            input: {
                availableLanguages: [LanguageCode.en, LanguageCode.de],
            },
        });

        // Create a channel whose default language is German
        await adminClient.query(createChannelDocument, {
            input: {
                code: 'de-channel',
                token: SECOND_CHANNEL_TOKEN,
                defaultLanguageCode: LanguageCode.de,
                currencyCode: CurrencyCode.EUR,
                pricesIncludeTax: true,
                defaultShippingZoneId: 'T_1',
                defaultTaxZoneId: 'T_1',
            },
        });

        adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);

        // Create a facet with EN and DE translations, but no FR translation
        await adminClient.query(createFacetDocument, {
            input: {
                isPrivate: false,
                code: 'brand',
                translations: [
                    { languageCode: LanguageCode.en, name: 'Brand (EN)' },
                    { languageCode: LanguageCode.de, name: 'Marke (DE)' },
                ],
                values: [
                    {
                        code: 'acme',
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Acme (EN)' },
                            { languageCode: LanguageCode.de, name: 'Acme (DE)' },
                        ],
                    },
                ],
            },
        });

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('FacetService.findByCode() language fallback', () => {
        it('returns exact translation when requested language matches', async () => {
            const facetService = server.app.get(FacetService);
            const requestContextService = server.app.get(RequestContextService);

            const ctx = await requestContextService.create({
                apiType: 'admin',
                channelOrToken: SECOND_CHANNEL_TOKEN,
                languageCode: LanguageCode.de,
            });

            const facet = await facetService.findByCode(ctx, 'brand', LanguageCode.de);

            expect(facet).toBeDefined();
            expect(facet!.name).toBe('Marke (DE)');
        });

        it('falls back to channel defaultLanguageCode when requested language has no translation', async () => {
            const facetService = server.app.get(FacetService);
            const requestContextService = server.app.get(RequestContextService);

            // Context: French requested, but channel default is German
            const ctx = await requestContextService.create({
                apiType: 'admin',
                channelOrToken: SECOND_CHANNEL_TOKEN,
                languageCode: LanguageCode.fr,
            });

            const facet = await facetService.findByCode(ctx, 'brand', LanguageCode.fr);

            // Should fall back to German (channel default), not English (system default)
            expect(facet).toBeDefined();
            expect(facet!.name).toBe('Marke (DE)');
        });
    });

    describe('FacetValueService.findAll() language fallback', () => {
        it('returns exact translation when requested language matches', async () => {
            const facetValueService = server.app.get(FacetValueService);
            const requestContextService = server.app.get(RequestContextService);

            const ctx = await requestContextService.create({
                apiType: 'admin',
                channelOrToken: SECOND_CHANNEL_TOKEN,
                languageCode: LanguageCode.de,
            });

            const facetValues = await facetValueService.findAll(ctx, LanguageCode.de);

            expect(facetValues.length).toBeGreaterThan(0);
            const acme = facetValues.find(fv => fv.code === 'acme');
            expect(acme).toBeDefined();
            expect(acme!.name).toBe('Acme (DE)');
        });

        it('falls back to channel defaultLanguageCode when requested language has no translation', async () => {
            const facetValueService = server.app.get(FacetValueService);
            const requestContextService = server.app.get(RequestContextService);

            // Context: French requested, but channel default is German
            const ctx = await requestContextService.create({
                apiType: 'admin',
                channelOrToken: SECOND_CHANNEL_TOKEN,
                languageCode: LanguageCode.fr,
            });

            const facetValues = await facetValueService.findAll(ctx, LanguageCode.fr);

            // Should fall back to German (channel default), not English (system default)
            expect(facetValues.length).toBeGreaterThan(0);
            const acme = facetValues.find(fv => fv.code === 'acme');
            expect(acme).toBeDefined();
            expect(acme!.name).toBe('Acme (DE)');
        });
    });
});
