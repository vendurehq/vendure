import { PluginCommonModule } from '../plugin-common.module';
import { VendurePlugin } from '../vendure-plugin';

import { PLUGIN_INIT_OPTIONS } from './constants';
import { RedisCacheStrategy } from './redis-cache-strategy';
import { RedisCachePluginInitOptions } from './types';

/**
 * @description
 * This plugin provides a Redis-based {@link RedisCacheStrategy} which stores cached items in a Redis instance.
 * This is a high-performance cache strategy which is suitable for production use, and is a drop-in
 * replacement for the {@link DefaultCachePlugin}.
 *
 * Note: To use this plugin, you need to manually install the `ioredis` package:
 *
 * ```shell
 * npm install ioredis@^5.3.2
 * ```
 *
 * @docsCategory cache
 * @docsPage RedisCachePlugin
 * @docsWeight 0
 * @since 3.1.0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [{ provide: PLUGIN_INIT_OPTIONS, useFactory: () => RedisCachePlugin.options }],
    configuration: config => {
        config.systemOptions.cacheStrategy = new RedisCacheStrategy(RedisCachePlugin.options);
        return config;
    },
    compatibility: '>0.0.0',
})
export class RedisCachePlugin {
    static options: RedisCachePluginInitOptions = {
        maxItemSizeInBytes: 128_000,
        redisOptions: {},
        namespace: 'vendure-cache',
    };

    static init(options: RedisCachePluginInitOptions) {
        this.options = options;
        return RedisCachePlugin;
    }
}
