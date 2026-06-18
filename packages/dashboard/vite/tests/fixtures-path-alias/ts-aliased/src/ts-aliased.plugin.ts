import { PluginCommonModule, VendurePlugin } from '@vendure/core';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [],
    dashboard: './dashboard/index.tsx',
})
export class TsAliasedPlugin {}
