import { PluginCommonModule, VendurePlugin } from '@vendure/core';

@VendurePlugin({
    imports: [PluginCommonModule],
    dashboard: './dashboard/index.tsx',
})
export class TestWorkspacePlugin {}
