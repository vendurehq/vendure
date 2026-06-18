import { schemaInfo } from 'virtual:admin-api-schema';

/**
 * @description
 * Runtime access to the LanguageCode enum values defined in the GraphQL schema.
 */
export const schemaLanguageCodes = schemaInfo.enums.LanguageCode ?? [];

/**
 * @description
 * Runtime access to the CurrencyCode enum values defined in the GraphQL schema.
 */
export const schemaCurrencyCodes = schemaInfo.enums.CurrencyCode ?? [];
