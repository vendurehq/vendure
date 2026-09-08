import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { Invoice } from './invoice.js';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [],
    dashboard: './dashboard/index.tsx',
})
export class MyPlugin {
    static invoice = Invoice;
}
