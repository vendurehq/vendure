import { VendurePlugin } from '@vendure/core';

/**
 * A test plugin exercising the Insights extension API (widgets, multi-instance widgets,
 * filters, excludeWidgets). See `./dashboard/index.tsx` for the extension entry point.
 */
@VendurePlugin({
    dashboard: './dashboard/index.tsx',
})
export class InsightsTestPlugin {}
