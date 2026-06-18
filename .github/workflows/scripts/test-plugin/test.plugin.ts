import { PluginCommonModule, VendurePlugin } from '@vendure/core';

/**
 * This plugin is to test that the Dashboard will successfully compile and display a
 * dashboard extension.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    dashboard: './dashboard/index.tsx',
    compatibility: '>=3.0.0',
})
export class TestPlugin {}
