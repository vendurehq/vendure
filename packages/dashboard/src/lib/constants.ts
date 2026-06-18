import { schemaCurrencyCodes } from '@/vdb/graphql/schema-enums.js';

export const NEW_ENTITY_PATH = 'new';
// Must match the literal passed to createFileRoute() in src/app/routes/_authenticated.tsx.
export const AUTHENTICATED_ROUTE_PREFIX = '/_authenticated';
export const DEFAULT_CHANNEL_CODE = '__default_channel__';
export const SUPER_ADMIN_ROLE_CODE = '__super_admin_role__';
export const CUSTOMER_ROLE_CODE = '__customer_role__';

/**
 * Local storage keys
 */
export const LS_KEY_SESSION_TOKEN = 'vendure-session-token';
export const LS_KEY_USER_SETTINGS = 'vendure-user-settings';
export const LS_KEY_SELECTED_CHANNEL_TOKEN = 'vendure-selected-channel-token';
export const LS_KEY_SHIPPING_TEST_ORDER = 'vendure-shipping-test-order';
export const LS_KEY_SHIPPING_TEST_ADDRESS = 'vendure-shipping-test-address';

/**
 * @description
 * Runtime access to the CurrencyCode enum values derived from the schema.
 */
export const CurrencyCode = Object.fromEntries(
    schemaCurrencyCodes.map((code: string) => [code, code]),
) as Record<string, string>;
