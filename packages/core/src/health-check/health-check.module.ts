import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { Logger } from '../config/logger/vendure-logger';
import { JobQueueModule } from '../job-queue/job-queue.module';

import { HealthCheckRegistryService } from './health-check-registry.service';
import { HealthController } from './health-check.controller';
import { CustomHttpHealthIndicator } from './http-health-check-strategy';

@Module({
    imports: [TerminusModule, ConfigModule, JobQueueModule],
    controllers: [HealthController],
    providers: [HealthCheckRegistryService, CustomHttpHealthIndicator],
    exports: [HealthCheckRegistryService],
})
export class HealthCheckModule {
    constructor(private configService: ConfigService) {
        const healthChecks = this.configService.systemOptions.healthChecks;
        if (healthChecks.length > 0) {
            Logger.warn(
                'The built-in health check features are deprecated and will be removed in v4.0.0. ' +
                    'Application-level health checks are an anti-pattern — health monitoring should be handled ' +
                    'by your infrastructure (e.g. Kubernetes probes, Docker healthchecks, load balancer checks). ' +
                    'To suppress this warning, set `systemOptions.healthChecks` to an empty array `[]`.',
                'HealthCheckModule',
            );
        }
    }
}
