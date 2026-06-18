import { DynamicModule, Module } from '@nestjs/common';

import { getConfig } from '../config/config-helpers';
import { ConfigModule } from '../config/config.module';

/**
 * This module collects and re-exports all providers defined in plugins so that they can be used in other
 * modules.
 */
@Module({
    imports: [ConfigModule],
})
export class PluginModule {
    static forRoot(): DynamicModule {
        return {
            module: PluginModule,
            imports: [...getConfig().plugins],
        };
    }
}
