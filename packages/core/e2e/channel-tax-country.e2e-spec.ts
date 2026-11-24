/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, DeletionResult, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    AddressBasedTaxZoneStrategy,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createCountryDocument, deleteCountryDocument } from './graphql/admin-definitions';
import { graphql as adminGraphql } from './graphql/graphql-admin';
import { graphql as shopGraphql } from './graphql/graphql-shop';
import {
    assignProductToChannelDocument,
    createChannelDocument,
    createTaxRateDocument,
    createZoneDocument,
    deleteTaxRateDocument,
    getProductsWithVariantPricesDocument,
    getTaxRatesListDocument,
    updateCountryDocument,
    updateProductVariantsDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderWithPriceDataDocument,
    setShippingAddressDocument,
} from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

const updateChannelTaxCountryDocument = adminGraphql(`
    mutation UpdateChannelTaxCountry($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            ... on Channel {
                id
                taxCountryCode
            }
        }
    }
`);

const productVariantPricesDocument = shopGraphql(`
    query ProductVariantPrices($id: ID!) {
        product(id: $id) {
            variants {
                id
                price
                priceWithTax
            }
        }
    }
`);

const searchVariantPricesDocument = shopGraphql(`
    query SearchVariantPrices {
        search(input: { groupByProduct: false, take: 100 }) {
            items {
                productVariantId
                price {
                    ... on SinglePrice {
                        value
                    }
                }
                priceWithTax {
                    ... on SinglePrice {
                        value
                    }
                }
            }
        }
    }
`);

// EU One-Stop Shop with prices that include tax: the default `eu` Zone holds DE and FR and has only
// country rates, DE 19% and FR 20%. The entered price is 119.00. With the tax country DE, it is the
// gross price of a DE order, 100.00 net plus 19%.
describe('Channel.taxCountryCode', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            taxOptions: { taxZoneStrategy: new AddressBasedTaxZoneStrategy() },
            plugins: [DefaultSearchPlugin, DefaultJobQueuePlugin],
        }),
    );
    const standardTaxCategoryId = 'T_1';
    const countryIds: Record<string, string> = {};
    let productId: string;
    let euZoneId: string;
    let variantId: string;

    const address = (countryCode: string) => ({
        countryCode,
        streetLine1: '1 Main St',
        city: 'City',
        postalCode: '12345',
    });

    async function setTaxCountry(taxCountryCode: string | null) {
        const { updateChannel } = await adminClient.query(updateChannelTaxCountryDocument, {
            input: { id: 'T_1', taxCountryCode },
        });
        return updateChannel as { id: string; taxCountryCode: string | null };
    }

    async function orderLinePrices(countryCode?: string) {
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, { productVariantId: variantId, quantity: 1 });
        if (countryCode) {
            await shopClient.query(setShippingAddressDocument, { input: address(countryCode) });
        }
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        const { unitPrice, unitPriceWithTax, taxRate } = activeOrder!.lines[0];
        return { unitPrice, unitPriceWithTax, taxRate };
    }

    async function productPagePrices() {
        const { product } = await shopClient.query(productVariantPricesDocument, { id: productId });
        const { price, priceWithTax } = product!.variants.find(v => v.id === variantId)!;
        return { price, priceWithTax };
    }

    async function indexedPrices(channelToken = E2E_DEFAULT_CHANNEL_TOKEN) {
        await awaitRunningJobs(adminClient);
        shopClient.setChannelToken(channelToken);
        const { search } = await shopClient.query(searchVariantPricesDocument);
        shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const item = search.items.find(i => i.productVariantId === variantId)!;
        return {
            price: (item.price as { value: number }).value,
            priceWithTax: (item.priceWithTax as { value: number }).value,
        };
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const [code, name] of [
            ['DE', 'Germany'],
            ['FR', 'France'],
            ['LU', 'Luxembourg'],
        ]) {
            const { createCountry } = await adminClient.query(createCountryDocument, {
                input: { code, enabled: true, translations: [{ languageCode: LanguageCode.en, name }] },
            });
            countryIds[code] = createCountry.id;
        }
        const { createZone } = await adminClient.query(createZoneDocument, {
            input: { name: 'eu', memberIds: [countryIds.DE, countryIds.FR, countryIds.LU] },
        });
        euZoneId = createZone.id;
        await adminClient.query(updateChannelTaxCountryDocument, {
            input: { id: 'T_1', defaultTaxZoneId: createZone.id, pricesIncludeTax: true },
        });
        for (const [code, value] of [
            ['DE', 19],
            ['FR', 20],
        ] as const) {
            await adminClient.query(createTaxRateDocument, {
                input: {
                    name: code,
                    categoryId: standardTaxCategoryId,
                    regionId: countryIds[code],
                    enabled: true,
                    value,
                },
            });
        }
        const { products } = await adminClient.query(getProductsWithVariantPricesDocument);
        productId = products.items[0].id;
        variantId = products.items[0].variants[0].id;
        await adminClient.query(updateProductVariantsDocument, { input: [{ id: variantId, price: 11900 }] });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a code that is not a country is refused', async () => {
        await expect(setTaxCountry('XX')).rejects.toThrow(
            'The taxCountryCode "XX" is not the code of a country',
        );
    });

    describe('with no tax country', () => {
        it('a DE order keeps the entered price as gross', async () => {
            expect(await orderLinePrices('DE')).toEqual({
                unitPrice: 10000,
                unitPriceWithTax: 11900,
                taxRate: 19,
            });
        });

        it('an FR order keeps the entered price as gross too, because the included rate is unknown', async () => {
            expect(await orderLinePrices('FR')).toEqual({
                unitPrice: 9917,
                unitPriceWithTax: 11900,
                taxRate: 20,
            });
        });

        it('a price with no shipping country has no tax', async () => {
            expect(await productPagePrices()).toEqual({ price: 11900, priceWithTax: 11900 });
            expect(await orderLinePrices()).toEqual({
                unitPrice: 11900,
                unitPriceWithTax: 11900,
                taxRate: 0,
            });
        });
    });

    describe('with the tax country DE', () => {
        beforeAll(async () => {
            expect(await setTaxCountry('DE')).toEqual({ id: 'T_1', taxCountryCode: 'DE' });
        });

        it('a DE order keeps the entered price as gross', async () => {
            expect(await orderLinePrices('DE')).toEqual({
                unitPrice: 10000,
                unitPriceWithTax: 11900,
                taxRate: 19,
            });
        });

        it('an FR order takes the net out at 19% and adds 20%', async () => {
            expect(await orderLinePrices('FR')).toEqual({
                unitPrice: 10000,
                unitPriceWithTax: 12000,
                taxRate: 20,
            });
        });

        it('a country of the zone with no country rate takes the net out at 19% and adds 0%', async () => {
            expect(await orderLinePrices('LU')).toEqual({
                unitPrice: 10000,
                unitPriceWithTax: 10000,
                taxRate: 0,
            });
        });

        it('a price with no shipping country gets the DE rate', async () => {
            expect(await productPagePrices()).toEqual({ price: 10000, priceWithTax: 11900 });
            expect(await orderLinePrices()).toEqual({
                unitPrice: 10000,
                unitPriceWithTax: 11900,
                taxRate: 19,
            });
        });

        it('the search index has the DE prices', async () => {
            expect(await indexedPrices()).toEqual({ price: 10000, priceWithTax: 11900 });
        });

        it('changing the tax country reindexes the Channel', async () => {
            await setTaxCountry('FR');
            try {
                // 119.00 is now the FR gross price: 99.17 net plus 20%
                expect(await indexedPrices()).toEqual({ price: 9917, priceWithTax: 11900 });
            } finally {
                await setTaxCountry('DE');
            }
            expect(await indexedPrices()).toEqual({ price: 10000, priceWithTax: 11900 });
        });

        it('editing the rate of the tax country reindexes the Channel', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument);
            const de = taxRates.items.find(r => r.name === 'DE')!;
            await adminClient.query(updateTaxRateDocument, { input: { id: de.id, value: 25 } });
            try {
                // The price still includes the DE rate, now 25%: 95.20 net
                expect(await indexedPrices()).toEqual({ price: 9520, priceWithTax: 11900 });
            } finally {
                await adminClient.query(updateTaxRateDocument, { input: { id: de.id, value: 19 } });
            }
            expect(await indexedPrices()).toEqual({ price: 10000, priceWithTax: 11900 });
        });
    });

    describe('guarding the tax country', () => {
        it('a country used as a tax country cannot be deleted', async () => {
            await setTaxCountry('LU');
            const { deleteCountry } = await adminClient.query(deleteCountryDocument, { id: countryIds.LU });
            expect(deleteCountry).toEqual({
                result: DeletionResult.NOT_DELETED,
                message:
                    'The selected Country cannot be deleted as it is the tax country of the following Channels: __default_channel__',
            });
        });

        it('changing the code of the tax country updates the Channel, and its rate still applies', async () => {
            await setTaxCountry('DE');
            await adminClient.query(updateCountryDocument, { input: { id: countryIds.DE, code: 'XD' } });
            try {
                const { updateChannel } = await adminClient.query(updateChannelTaxCountryDocument, {
                    input: { id: 'T_1' },
                });
                expect(updateChannel).toEqual({ id: 'T_1', taxCountryCode: 'XD' });
                // The DE country rate is found by the new code
                expect(await productPagePrices()).toEqual({ price: 10000, priceWithTax: 11900 });
            } finally {
                await adminClient.query(updateCountryDocument, { input: { id: countryIds.DE, code: 'DE' } });
            }
            expect((await setTaxCountry(null)).taxCountryCode).toBeNull();
        });

        it('a country no Channel uses can be deleted', async () => {
            const { deleteCountry } = await adminClient.query(deleteCountryDocument, { id: countryIds.LU });
            expect(deleteCountry.result).toBe(DeletionResult.DELETED);
        });
    });

    // TaxRates are global, so editing one from the default Channel changes another Channel's prices.
    describe('search index of another Channel with the tax country DE', () => {
        const secondToken = 'second-channel-token';

        beforeAll(async () => {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code: 'second-channel',
                    token: secondToken,
                    defaultLanguageCode: LanguageCode.en,
                    defaultCurrencyCode: CurrencyCode.USD,
                    pricesIncludeTax: true,
                    defaultTaxZoneId: euZoneId,
                    defaultShippingZoneId: euZoneId,
                    taxCountryCode: 'DE',
                },
            });
            const channelId = (createChannel as { id: string }).id;
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId, productIds: [productId], priceFactor: 1 },
            });
        });

        it('has the DE prices', async () => {
            expect(await indexedPrices(secondToken)).toEqual({ price: 10000, priceWithTax: 11900 });
        });

        it('editing the DE rate from the default Channel reindexes it', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument);
            const de = taxRates.items.find(r => r.name === 'DE')!;
            await adminClient.query(updateTaxRateDocument, { input: { id: de.id, value: 25 } });
            try {
                expect(await indexedPrices(secondToken)).toEqual({ price: 9520, priceWithTax: 11900 });
            } finally {
                await adminClient.query(updateTaxRateDocument, { input: { id: de.id, value: 19 } });
            }
            expect(await indexedPrices(secondToken)).toEqual({ price: 10000, priceWithTax: 11900 });
        });

        it('deleting the DE rate reindexes it', async () => {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument);
            const de = taxRates.items.find(r => r.name === 'DE')!;
            await adminClient.query(deleteTaxRateDocument, { id: de.id });
            // With no included rate and no rate for DE, the entered price is kept and no tax is added.
            expect(await indexedPrices(secondToken)).toEqual({ price: 11900, priceWithTax: 11900 });
        });
    });
});
