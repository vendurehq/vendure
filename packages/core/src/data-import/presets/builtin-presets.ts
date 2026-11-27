import { CurrencyCode } from '@vendure/common/lib/generated-types';

import { EU_VAT_RATES } from './eu-vat-rates';
import { isIsoCountryCode } from './iso-countries';
import { Preset } from './preset-types';
import { seedBaseData } from './seed-base-data';

const EU_COUNTRY_CODES = EU_VAT_RATES.map(r => r.countryCode);

/**
 * EUR, prices include VAT. One `EU` zone with the 27 member states, and a standard and a reduced
 * rate for each member state, as the One-Stop Shop scheme needs. The seller's member state is the
 * channel's tax country, so its rates are the ones the entered prices include, and the zone needs no
 * rate of its own.
 */
export const euPreset: Preset = {
    name: 'eu',
    description:
        'EUR, prices include VAT. Standard and reduced VAT for each EU member state (One-Stop Shop), and an EU shipping zone.',
    options: {
        country: {
            description:
                "The seller's own member state, as an ISO 3166-1 alpha-2 code (for example DE). Its rates are the ones entered prices include.",
            required: true,
        },
    },
    validate(options) {
        if (!EU_COUNTRY_CODES.includes(options.country)) {
            return {
                option: 'country',
                reason: `must be an EU member state, one of ${EU_COUNTRY_CODES.join(', ')}`,
            };
        }
        return undefined;
    },
    apply(ctx, services, options) {
        // validate() has checked that the country is a member state.
        return seedBaseData(ctx, services, {
            preset: 'eu',
            options,
            currencyCode: CurrencyCode.EUR,
            pricesIncludeTax: true,
            zone: { name: 'EU', countryCodes: EU_COUNTRY_CODES },
            taxCountryCode: options.country,
            taxCategories: [
                {
                    name: 'Standard',
                    isDefault: true,
                    countryRates: Object.fromEntries(EU_VAT_RATES.map(r => [r.countryCode, r.standard])),
                },
                {
                    name: 'Reduced',
                    countryRates: Object.fromEntries(EU_VAT_RATES.map(r => [r.countryCode, r.reduced])),
                },
            ],
        });
    },
};

/** GBP, prices include VAT at 20, 5 and 0. */
export const ukPreset: Preset = {
    name: 'uk',
    description: 'GBP, prices include VAT. VAT at 20, 5 and 0, and a UK shipping zone.',
    apply(ctx, services, options) {
        return seedBaseData(ctx, services, {
            preset: 'uk',
            options,
            currencyCode: CurrencyCode.GBP,
            pricesIncludeTax: true,
            zone: { name: 'UK', countryCodes: ['GB'] },
            taxCategories: [
                { name: 'Standard', isDefault: true, zoneRate: 20 },
                { name: 'Reduced', zoneRate: 5 },
                { name: 'Zero', zoneRate: 0 },
            ],
        });
    },
};

/**
 * USD, prices exclude tax. US sales tax depends on the address and is best calculated by a tax
 * provider, so there are no static sales-tax rates: one standard category at 0 lets orders
 * calculate until one is set up.
 */
export const usPreset: Preset = {
    name: 'us',
    description:
        'USD, prices exclude tax. No static sales-tax rates: use a tax provider integration. A US shipping zone.',
    apply(ctx, services, options) {
        return seedBaseData(ctx, services, {
            preset: 'us',
            options,
            currencyCode: CurrencyCode.USD,
            pricesIncludeTax: false,
            zone: { name: 'US', countryCodes: ['US'] },
            taxCategories: [{ name: 'Standard', isDefault: true, zoneRate: 0 }],
        });
    },
};

/** AUD, prices include GST at 10. */
export const auPreset: Preset = {
    name: 'au',
    description: 'AUD, prices include GST. GST at 10 and a GST-free category, and an AU shipping zone.',
    apply(ctx, services, options) {
        return seedBaseData(ctx, services, {
            preset: 'au',
            options,
            currencyCode: CurrencyCode.AUD,
            pricesIncludeTax: true,
            zone: { name: 'AU', countryCodes: ['AU'] },
            taxCategories: [
                { name: 'Standard', isDefault: true, zoneRate: 10 },
                { name: 'Zero', zoneRate: 0 },
            ],
        });
    },
};

/** One country and currency, with one standard rate at 0 for the merchant to fill in. */
export const singleCountryPreset: Preset = {
    name: 'single-country',
    description:
        'One country and currency, prices include tax. One zone and one standard rate at 0, to set to your rate.',
    options: {
        country: {
            description: 'The country, as an ISO 3166-1 alpha-2 code, for example NZ.',
            required: true,
        },
        currency: {
            description: 'The currency, as an ISO 4217 code, for example NZD.',
            required: true,
        },
    },
    validate(options) {
        if (!isIsoCountryCode(options.country)) {
            return { option: 'country', reason: 'must be an ISO 3166-1 alpha-2 country code, such as NZ' };
        }
        if (!Object.values(CurrencyCode).includes(options.currency as CurrencyCode)) {
            return { option: 'currency', reason: 'must be an ISO 4217 currency code, such as NZD' };
        }
        return undefined;
    },
    apply(ctx, services, options) {
        return seedBaseData(ctx, services, {
            preset: 'single-country',
            options,
            currencyCode: options.currency as CurrencyCode,
            pricesIncludeTax: true,
            zone: { name: options.country, countryCodes: [options.country] },
            taxCategories: [
                {
                    name: 'Standard',
                    isDefault: true,
                    zoneRate: 0,
                    zoneRateName: 'Standard rate, set the value',
                },
            ],
        });
    },
};
