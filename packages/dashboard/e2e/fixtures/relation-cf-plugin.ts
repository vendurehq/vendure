import { VendurePlugin } from '@vendure/core';

/**
 * E2E-only plugin whose dashboard extension registers the custom form components of the readonly
 * relation custom fields `Product.relatedAsset` and `Product.relatedAssets` (#4902).
 *
 * The dashboard extension is discovered by the Vite plugin's config introspection and dynamically
 * imported at build time.
 */
@VendurePlugin({
    dashboard: './relation-cf-dashboard/index.tsx',
})
export class RelationCfPlugin {}
