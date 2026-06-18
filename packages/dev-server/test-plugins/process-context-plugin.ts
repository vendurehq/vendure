import { OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Logger, PluginCommonModule, ProcessContext, VendurePlugin } from '@vendure/core';

/**
 * Testing whether the ProcessContext service is giving the correct results.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
})
export class ProcessContextPlugin implements OnApplicationBootstrap, OnModuleInit {
    constructor(private processContext: ProcessContext) {}

    onApplicationBootstrap(): any {
        Logger.warn(`onApplicationBootstrap: isServer: ${this.processContext.isServer}`);
    }

    onModuleInit(): any {
        Logger.warn(`onModuleInit: isServer: ${this.processContext.isServer}`);
    }
}
