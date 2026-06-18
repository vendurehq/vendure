import { VendurePlugin } from '@vendure/core';

/**
 * A test plugin that demonstrates the toolbarItems extension point by adding
 * several items to the app shell header toolbar.
 */
@VendurePlugin({
    dashboard: './dashboard/index.tsx',
})
export class ToolbarTestPlugin {}
