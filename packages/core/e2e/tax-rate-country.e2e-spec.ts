/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { AddressBasedTaxZoneStrategy, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createCountryDocument } from './graphql/admin-definitions';
import {
    addMembersToZoneDocument,
    createTaxRateDocument,
    createZoneDocument,
    getCountryListDocument,
    getProductsWithVariantPricesDocument,
    getTaxRatesListDocument,
    getZonesDocument,
    removeMembersFromZoneDocument,
    updateChannelDocument,
    updateProductVariantsDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderWithPriceDataDocument,
    setShippingAddressDocument,
} from './graphql/shop-definitions';

// EU One-Stop Shop: one country rate per member state and a single 'eu' shipping zone, with the
// AddressBasedTaxZoneStrategy the tax guide recommends.
describe('Country tax rates', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { taxOptions: { taxZoneStrategy: new AddressBasedTaxZoneStrategy() } }),
    );
    let variantId: string;
    let secondVariantId: string;
    let euZoneId: string;
    // 'Standard Tax' is the first TaxCategory in the initial data
    const standardTaxCategoryId = 'T_1';
    const countryIds: Record<string, string> = {};

    async function taxRateFor(countryCode: string) {
        await shopClient.query(setShippingAddressDocument, {
            input: { countryCode, streetLine1: '1 Main St', city: 'City', postalCode: '12345' },
        });
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        return activeOrder!.lines[0].taxRate;
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
            ['IT', 'Italy'],
            ['CH', 'Switzerland'],
        ]) {
            const { createCountry } = await adminClient.query(createCountryDocument, {
                input: { code, enabled: true, translations: [{ languageCode: LanguageCode.en, name }] },
            });
            countryIds[code] = createCountry.id;
        }
        const { products } = await adminClient.query(getProductsWithVariantPricesDocument);
        variantId = products.items[0].variants[0].id;
        secondVariantId = products.items[0].variants[1].id;

        const { createZone } = await adminClient.query(createZoneDocument, {
            input: { name: 'eu', memberIds: [countryIds.DE, countryIds.FR, countryIds.IT] },
        });
        euZoneId = createZone.id;
        await adminClient.query(updateChannelDocument, {
            input: { id: 'T_1', defaultTaxZoneId: euZoneId },
        });
        await adminClient.query(createTaxRateDocument, {
            input: {
                name: 'EU fallback',
                categoryId: standardTaxCategoryId,
                zoneId: euZoneId,
                enabled: true,
                value: 22,
            },
        });
        await adminClient.query(createTaxRateDocument, {
            input: {
                name: 'DE',
                categoryId: standardTaxCategoryId,
                regionId: countryIds.DE,
                enabled: true,
                value: 19,
            },
        });
        await adminClient.query(createTaxRateDocument, {
            input: {
                name: 'FR',
                categoryId: standardTaxCategoryId,
                regionId: countryIds.FR,
                enabled: true,
                value: 20,
            },
        });
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, { productVariantId: variantId, quantity: 1 });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('an existing zone rate still resolves with no shipping country', async () => {
        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
        expect(activeOrder!.lines[0].taxRate).toBe(22);
    });

    it('a shipping address in DE gets the DE rate', async () => {
        expect(await taxRateFor('DE')).toBe(19);
    });

    it('a shipping address in FR gets the FR rate, with the same zone', async () => {
        expect(await taxRateFor('FR')).toBe(20);
    });

    it('a country in the zone with no country rate gets the zone rate', async () => {
        expect(await taxRateFor('IT')).toBe(22);
    });

    it('a country in another zone gets that zone rate', async () => {
        // US is in the Americas zone of the initial data, with a 20% standard rate.
        expect(await taxRateFor('US')).toBe(20);
    });

    it('a country outside every zone gets the channel default zone rate', async () => {
        expect(await taxRateFor('CH')).toBe(22);
    });

    it('editing a rate does not re-tax the lines an update did not touch', async () => {
        expect(await taxRateFor('DE')).toBe(19);
        const { taxRates } = await adminClient.query(getTaxRatesListDocument);
        const de = taxRates.items.find(r => r.name === 'DE')!;
        await adminClient.query(updateTaxRateDocument, { input: { id: de.id, value: 25 } });
        try {
            // Adding a line recalculates the Order, but only the new line gets the new rate.
            await shopClient.query(addItemToOrderDocument, {
                productVariantId: secondVariantId,
                quantity: 1,
            });
            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            expect(activeOrder!.lines.map(l => l.taxRate).sort((a, b) => a - b)).toEqual([19, 25]);
        } finally {
            await adminClient.query(updateTaxRateDocument, { input: { id: de.id, value: 19 } });
        }
    });

    it('a disabled country rate is skipped', async () => {
        const { taxRates } = await adminClient.query(getTaxRatesListDocument);
        const de = taxRates.items.find(r => r.name === 'DE')!;
        await adminClient.query(updateTaxRateDocument, { input: { id: de.id, enabled: false } });
        expect(await taxRateFor('DE')).toBe(22);
        await adminClient.query(updateTaxRateDocument, { input: { id: de.id, enabled: true } });
        expect(await taxRateFor('DE')).toBe(19);
    });

    // With prices that include tax, an entered price includes the default tax Zone's rate. It is kept
    // as gross where that rate applies, and elsewhere the net is taken out at it. A country rate counts
    // as another rate, so country rates give the same prices as one Zone per country (the v3 way).
    // The entered price is 120.00.
    describe('Channel.pricesIncludeTax = true', () => {
        let atId: string;
        let europeZoneId: string;

        async function linePricesFor(countryCode: string) {
            await shopClient.query(setShippingAddressDocument, {
                input: { countryCode, streetLine1: '1 Main St', city: 'City', postalCode: '12345' },
            });
            const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
            const { unitPrice, unitPriceWithTax, taxRate } = activeOrder!.lines[0];
            return { unitPrice, unitPriceWithTax, taxRate };
        }

        async function pricesForAtDeUs() {
            await shopClient.asAnonymousUser();
            await shopClient.query(addItemToOrderDocument, { productVariantId: variantId, quantity: 1 });
            return {
                AT: await linePricesFor('AT'),
                DE: await linePricesFor('DE'),
                US: await linePricesFor('US'),
            };
        }

        async function rateByName(name: string) {
            const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                options: { filter: { name: { eq: name } } },
            });
            return taxRates.items[0];
        }

        beforeAll(async () => {
            await adminClient.query(updateChannelDocument, {
                input: { id: 'T_1', pricesIncludeTax: true, defaultTaxZoneId: euZoneId },
            });
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: variantId, price: 12000 }],
            });
            const { countries } = await adminClient.query(getCountryListDocument, {
                options: { filter: { code: { eq: 'AT' } } },
            });
            atId = countries.items[0].id;
            const { zones } = await adminClient.query(getZonesDocument, {
                options: { filter: { name: { eq: 'Europe' } } },
            });
            europeZoneId = zones.items[0].id;
            // AT is in the initial data's Europe Zone. Move it to 'eu', so that the
            // AddressBasedTaxZoneStrategy returns the default tax Zone for AT and DE.
            await adminClient.query(removeMembersFromZoneDocument, {
                zoneId: europeZoneId,
                memberIds: [atId],
            });
            await adminClient.query(addMembersToZoneDocument, { zoneId: euZoneId, memberIds: [atId] });
            const euRate = await rateByName('EU fallback');
            await adminClient.query(updateTaxRateDocument, {
                input: { id: euRate.id, value: 20, enabled: true },
            });
            await adminClient.query(createTaxRateDocument, {
                input: {
                    name: 'AT',
                    categoryId: standardTaxCategoryId,
                    regionId: atId,
                    enabled: true,
                    value: 20,
                },
            });
        });

        it('eu zone rate 20%, country rates AT 20% and DE 19%', async () => {
            // A country rate is treated like the rate of another Zone: the net is taken out at the eu
            // zone rate (20%) and the country rate added, so DE pays 119.00 as in the v3-style setup.
            expect(await pricesForAtDeUs()).toEqual({
                AT: { unitPrice: 10000, unitPriceWithTax: 12000, taxRate: 20 },
                DE: { unitPrice: 10000, unitPriceWithTax: 11900, taxRate: 19 },
                US: { unitPrice: 10000, unitPriceWithTax: 12000, taxRate: 20 },
            });
        });

        it('a country rate with the eu zone rate value keeps the entered price', async () => {
            // 119.91 would become 119.92 if the net were taken out at 20% and 20% added again.
            await adminClient.query(updateProductVariantsDocument, {
                input: [{ id: variantId, price: 11991 }],
            });
            try {
                await shopClient.asAnonymousUser();
                await shopClient.query(addItemToOrderDocument, { productVariantId: variantId, quantity: 1 });
                expect(await linePricesFor('AT')).toEqual({
                    unitPrice: 9993,
                    unitPriceWithTax: 11991,
                    taxRate: 20,
                });
            } finally {
                await adminClient.query(updateProductVariantsDocument, {
                    input: [{ id: variantId, price: 12000 }],
                });
            }
        });

        it('eu without a zone rate, country rates AT 20% and DE 19%', async () => {
            const euRate = await rateByName('EU fallback');
            await adminClient.query(updateTaxRateDocument, { input: { id: euRate.id, enabled: false } });
            // The default Zone has no zone rate, so prices work as without country rates: 120.00 is
            // kept as gross for AT and DE, and US gets 0% taken out, so 20% is added to the whole 120.00.
            expect(await pricesForAtDeUs()).toEqual({
                AT: { unitPrice: 10000, unitPriceWithTax: 12000, taxRate: 20 },
                DE: { unitPrice: 10084, unitPriceWithTax: 12000, taxRate: 19 },
                US: { unitPrice: 12000, unitPriceWithTax: 14400, taxRate: 20 },
            });
        });

        it('v3 style: Zones AT 20% and DE 19%, default tax Zone AT', async () => {
            for (const name of ['AT', 'DE']) {
                const rate = await rateByName(name);
                await adminClient.query(updateTaxRateDocument, { input: { id: rate.id, enabled: false } });
            }
            await adminClient.query(removeMembersFromZoneDocument, {
                zoneId: euZoneId,
                memberIds: [atId, countryIds.DE],
            });
            const zoneIds: Record<string, string> = {};
            for (const [code, countryId, value] of [
                ['AT', atId, 20],
                ['DE', countryIds.DE, 19],
            ] as const) {
                const { createZone } = await adminClient.query(createZoneDocument, {
                    input: { name: `zone ${code}`, memberIds: [countryId] },
                });
                zoneIds[code] = createZone.id;
                await adminClient.query(createTaxRateDocument, {
                    input: {
                        name: `zone rate ${code}`,
                        categoryId: standardTaxCategoryId,
                        zoneId: createZone.id,
                        enabled: true,
                        value,
                    },
                });
            }
            await adminClient.query(updateChannelDocument, {
                input: { id: 'T_1', defaultTaxZoneId: zoneIds.AT },
            });
            // DE is not the default Zone, so its net is taken out at AT's 20% and DE's 19% added: 119.00,
            // the same as with country rates and an eu zone rate.
            expect(await pricesForAtDeUs()).toEqual({
                AT: { unitPrice: 10000, unitPriceWithTax: 12000, taxRate: 20 },
                DE: { unitPrice: 10000, unitPriceWithTax: 11900, taxRate: 19 },
                US: { unitPrice: 10000, unitPriceWithTax: 12000, taxRate: 20 },
            });
        });
    });
});
