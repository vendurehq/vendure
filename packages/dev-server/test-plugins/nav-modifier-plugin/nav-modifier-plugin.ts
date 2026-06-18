import { VendurePlugin } from '@vendure/core';

/**
 * A minimal test plugin that demonstrates the function form of `navSections`
 * in `defineDashboardExtension`. It moves the "Administrators" and "Roles"
 * items out of the "Settings" section into a new "Access & Identity" section.
 */
@VendurePlugin({
    dashboard: './dashboard/index.tsx',
})
export class NavModifierPlugin {}
