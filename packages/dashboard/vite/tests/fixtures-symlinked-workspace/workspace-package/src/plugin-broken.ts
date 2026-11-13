import { PluginCommonModule, VendurePlugin } from '@vendure/core';

// Declares a dashboard entry that does not exist on disk, to exercise the
// existence guard in discoverPlugins' source-registration loop.
@VendurePlugin({
    imports: [PluginCommonModule],
    dashboard: './dashboard/missing.tsx',
})
export class TestBrokenDashboardPlugin {}
