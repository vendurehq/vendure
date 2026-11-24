import { idSchema, int32Schema, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { countryCodeSchema, currencyCodeSchema, languageCodeSchema } from './setup-schemas';

/** Fields shared by create_channel and update_channel. Update makes them all optional. */
export const channelFieldsSchema = z.strictObject({
    code: shortText.describe('Unique channel code, e.g. "uk-store".'),
    token: shortText.describe(
        'Unique channel token. Clients send it in the vendure-token header to select this channel.',
    ),
    defaultLanguageCode: languageCodeSchema.describe(
        'Default language. It must be one of the languages available in the store.',
    ),
    availableLanguageCodes: z
        .array(languageCodeSchema)
        .max(100)
        .describe('Languages the channel offers. Must include the default language.')
        .optional(),
    defaultCurrencyCode: currencyCodeSchema.describe('Default currency for prices in this channel.'),
    availableCurrencyCodes: z
        .array(currencyCodeSchema)
        .max(100)
        .describe('Currencies the channel prices in. Must include the default currency.')
        .optional(),
    pricesIncludeTax: z
        .boolean()
        .describe('Whether the prices entered for this channel already include tax.'),
    defaultTaxZoneId: idSchema.describe('Zone used to calculate tax when an order has no address yet.'),
    defaultShippingZoneId: idSchema.describe('Zone used for shipping when an order has no address yet.'),
    taxCountryCode: countryCodeSchema
        .nullable()
        .describe(
            'Code of the country whose tax rate the entered prices include, e.g. "DE". Prices that ' +
                'include tax are split into net and tax at its rate. Null clears it.',
        )
        .optional(),
    trackInventory: z.boolean().describe('Whether stock levels are tracked by default.').optional(),
    outOfStockThreshold: int32Schema
        .describe('Stock level at or below which a variant counts as out of stock.')
        .optional(),
});

/**
 * The generated channel inputs type `taxCountryCode` as `string | undefined`. `ChannelService` clears
 * the tax country for `null` or an empty string, so a `null` from the tool is sent as an empty string.
 */
export function withTaxCountryCodeForCore<T extends { taxCountryCode?: string | null }>(
    input: T,
): Omit<T, 'taxCountryCode'> & { taxCountryCode?: string } {
    const { taxCountryCode, ...rest } = input;
    return taxCountryCode === undefined ? rest : { ...rest, taxCountryCode: taxCountryCode ?? '' };
}
