import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Provider method to simulate __dirname variable.
 */
export const getDirname = (url: string, ...subDir: string[]) => {
    return join(dirname(fileURLToPath(url)), ...subDir);
};

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [],
    dashboard: './dashboard/index.tsx',
})
export class MyPlugin {
    static options = {
        projectDir: getDirname(import.meta.url, '../templates'),
    };
}
