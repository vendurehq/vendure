import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import pkg from '../package.json';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [],
    dashboard: './dashboard/index.tsx',
})
export class MyPlugin {
    static version = pkg.version;
}
