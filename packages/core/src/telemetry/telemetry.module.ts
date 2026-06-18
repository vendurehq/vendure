import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import { ConnectionModule } from '../connection/connection.module';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { ProcessContextModule } from '../process-context/process-context.module';
import { SettingsStoreService } from '../service/helpers/settings-store/settings-store.service';

import { ConfigCollector } from './collectors/config.collector';
import { DatabaseCollector } from './collectors/database.collector';
import { DeploymentCollector } from './collectors/deployment.collector';
import { FeaturesCollector } from './collectors/features.collector';
import { InstallationIdCollector } from './collectors/installation-id.collector';
import { PluginCollector } from './collectors/plugin.collector';
import { SystemInfoCollector } from './collectors/system-info.collector';
import { TelemetryService } from './telemetry.service';

/**
 * @description
 * The TelemetryModule provides anonymous usage data collection for Vendure.
 * It collects data on application startup and sends it to the Vendure telemetry endpoint.
 *
 * **Privacy guarantees:**
 * - Installation ID is a random UUID
 * - Custom plugin names are NOT collected
 * - Entity counts use ranges, not exact numbers
 * - No PII is collected
 *
 * **Opt-out:**
 * Set `VENDURE_DISABLE_TELEMETRY=true` to disable.
 *
 * @docsCategory Telemetry
 * @since 3.6.0
 */
@Module({
    imports: [ProcessContextModule, ConfigModule, ConnectionModule, JobQueueModule],
    providers: [
        TelemetryService,
        SettingsStoreService,
        InstallationIdCollector,
        SystemInfoCollector,
        DatabaseCollector,
        PluginCollector,
        ConfigCollector,
        DeploymentCollector,
        FeaturesCollector,
    ],
    exports: [TelemetryService],
})
export class TelemetryModule {}
