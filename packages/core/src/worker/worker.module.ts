import { Module, OnApplicationShutdown } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import { Logger } from '../config/logger/vendure-logger';
import { ConnectionModule } from '../connection/connection.module';
import { I18nModule } from '../i18n/i18n.module';
import { PluginModule } from '../plugin/plugin.module';
import { ProcessContextModule } from '../process-context/process-context.module';
import { ServiceModule } from '../service/service.module';

import { WorkerHealthService } from './worker-health.service';

/**
 * This is the main module used when bootstrapping the worker process via
 * `bootstrapWorker()`. It contains the same imports as the AppModule except
 * for the ApiModule, which is not needed for the worker. Omitting the ApiModule
 * greatly increases startup time (about 4x in testing).
 */
@Module({
    imports: [
        ProcessContextModule,
        ConfigModule,
        I18nModule,
        PluginModule.forRoot(),
        ConnectionModule.forRoot(),
        ServiceModule,
    ],
    providers: [WorkerHealthService],
})
export class WorkerModule implements OnApplicationShutdown {
    async onApplicationShutdown(signal?: string) {
        if (signal) {
            Logger.info('Received shutdown signal:' + signal);
        }
    }
}
