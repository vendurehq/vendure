import { ConfigurableOperationInput, CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { longText, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

/** The most country codes one zone or one `enable_countries` call takes. */
export const MAX_COUNTRY_CODES = 300;

/** A country's ISO 3166-1 alpha-2 code, as Vendure stores it. */
export const countryCodeSchema = shortText.describe('Country code, e.g. "DE".');

export const countryCodesSchema = z.array(countryCodeSchema).max(MAX_COUNTRY_CODES);

export const currencyCodeSchema = z.enum(CurrencyCode).describe('Currency code, e.g. "USD".');

export const languageCodeSchema = z.enum(LanguageCode).describe('Language code, e.g. "en".');

/**
 * A configurable operation, such as a shipping calculator or a payment handler, written the way an
 * agent reads it: the operation's code and its arguments by name. `list_shipping_options` and
 * `list_payment_options` list the codes and the arguments each one takes. Core validates the
 * arguments, so the tool does not repeat their schemas.
 */
export const configurableOperationSchema = z.strictObject({
    code: shortText.describe('The operation code, from list_shipping_options or list_payment_options.'),
    args: z
        .record(shortText, z.unknown())
        .describe('Argument values by argument name. An argument left out takes its default.')
        .optional(),
});

export type ConfigurableOperationToolInput = z.infer<typeof configurableOperationSchema>;

/**
 * Core stores every argument as a string and parses it by the argument's declared type. A string is
 * passed as it is; any other value is sent as JSON, which is how core reads numbers, booleans and
 * lists.
 */
export function toConfigurableOperationInput(
    operation: ConfigurableOperationToolInput,
): ConfigurableOperationInput {
    return {
        code: operation.code,
        arguments: Object.entries(operation.args ?? {}).map(([name, value]) => ({
            name,
            value: typeof value === 'string' ? value : JSON.stringify(value),
        })),
    };
}

/** A name and a description in one language, for shipping and payment methods. */
export const methodTranslationSchema = z.strictObject({
    languageCode: languageCodeSchema,
    name: shortText.describe('Name shown to customers.').optional(),
    description: longText.describe('Description shown to customers.').optional(),
});

/** At most one translation per language. */
export const methodTranslationsSchema = z
    .array(methodTranslationSchema)
    .max(Object.values(LanguageCode).length)
    .describe('Name and description per language. At least one entry is needed on create.');
