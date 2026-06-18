import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ConfigModule, VendurePlugin } from '@vendure/core';

@VendurePlugin({
    imports: [ConfigModule],
    configuration: config => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        config.defaultLanguageCode = LanguageCode.zh;
        return config;
    },
})
export class TestPluginWithConfig {
    static setup() {
        return TestPluginWithConfig;
    }
}
