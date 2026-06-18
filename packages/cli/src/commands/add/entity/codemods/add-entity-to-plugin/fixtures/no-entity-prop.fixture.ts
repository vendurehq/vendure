import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

type PluginInitOptions = any;

@VendurePlugin({
    imports: [PluginCommonModule],
    compatibility: '^3.0.0',
})
export class TestOnePlugin {
    static options: PluginInitOptions;

    static init(options: PluginInitOptions): Type<TestOnePlugin> {
        this.options = options;
        return TestOnePlugin;
    }
}
