import { PluginCommonModule, VendurePlugin } from '@vendure/core';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [],
    dashboard: { location: './dashboard/index.tsx' },
})
export class MyPlugin {}
