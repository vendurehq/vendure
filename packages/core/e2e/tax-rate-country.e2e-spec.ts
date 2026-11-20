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
    createTaxRateDocument,
    createZoneDocument,
    getProductsWithVariantPricesDocument,
    getTaxRatesListDocument,
    updateChannelDocument,
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
});
