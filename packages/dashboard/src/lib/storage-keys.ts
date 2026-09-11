/**
 * The local storage keys, kept in their own module so the Playwright suite can
 * import them. They cannot live in `constants.ts`, because that imports
 * `schema-enums.js`, which imports `virtual:admin-api-schema` — a module only
 * the Vite build provides. Importing `constants.ts` from Playwright's Node
 * runtime therefore fails to resolve.
 *
 * `constants.ts` re-exports everything below, so application code keeps
 * importing these from `@/vdb/constants.js` as before. Add new keys here and to
 * that re-export, not to `constants.ts` directly.
 */
export const LS_KEY_SESSION_TOKEN = 'vendure-session-token';
export const LS_KEY_USER_SETTINGS = 'vendure-user-settings';
export const LS_KEY_SELECTED_CHANNEL_TOKEN = 'vendure-selected-channel-token';
export const LS_KEY_SHIPPING_TEST_ORDER = 'vendure-shipping-test-order';
export const LS_KEY_SHIPPING_TEST_ADDRESS = 'vendure-shipping-test-address';
