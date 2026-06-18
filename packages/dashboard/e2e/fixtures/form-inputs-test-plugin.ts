import { VendurePlugin } from '@vendure/core';

/**
 * E2E-only plugin that provides a dashboard test page for verifying
 * form input components (disabled state, value handling, etc.).
 *
 * The dashboard extension is discovered by the Vite plugin's config
 * introspection and dynamically imported at dev-server startup.
 */
@VendurePlugin({
    dashboard: './form-inputs-test-dashboard/index.tsx',
})
export class FormInputsTestPlugin {}
