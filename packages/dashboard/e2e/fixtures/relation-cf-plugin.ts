import { VendurePlugin } from '@vendure/core';

/**
 * E2E-only plugin whose dashboard extension registers a custom form component for the readonly
 * `Product.relatedAsset` relation custom field. Used to verify OSS-584 (#4902): the component
 * must receive the related entity object as `value`.
 *
 * The dashboard extension is discovered by the Vite plugin's config introspection and dynamically
 * imported at build time.
 */
@VendurePlugin({
    dashboard: './relation-cf-dashboard/index.tsx',
})
export class RelationCfPlugin {}
