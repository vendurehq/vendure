import { schemaCurrencyCodes } from '@/vdb/graphql/schema-enums.js';

export {
    LS_KEY_SELECTED_CHANNEL_TOKEN,
    LS_KEY_SESSION_TOKEN,
    LS_KEY_SHIPPING_TEST_ADDRESS,
    LS_KEY_SHIPPING_TEST_ORDER,
    LS_KEY_USER_SETTINGS,
} from './storage-keys.js';

export const NEW_ENTITY_PATH = 'new';
// Must match the literal passed to createFileRoute() in src/app/routes/_authenticated.tsx.
export const AUTHENTICATED_ROUTE_PREFIX = '/_authenticated';
export const DEFAULT_CHANNEL_CODE = '__default_channel__';
export const SUPER_ADMIN_ROLE_CODE = '__super_admin_role__';
export const CUSTOMER_ROLE_CODE = '__customer_role__';

/**
 * @description
 * Runtime access to the CurrencyCode enum values derived from the schema.
 */
export const CurrencyCode = Object.fromEntries(
    schemaCurrencyCodes.map((code: string) => [code, code]),
) as Record<string, string>;
