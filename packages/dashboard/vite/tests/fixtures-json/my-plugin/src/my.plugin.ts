import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import pluginData from './plugin-data.json';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [],
    dashboard: './dashboard/index.tsx',
})
export class MyPlugin {
    static sheetId = pluginData.sheetId;
}
