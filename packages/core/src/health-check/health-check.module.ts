import { Module } from '@nestjs/common';

import { HealthController } from './health-check.controller';

/**
 * Serves the unconditional `/health` liveness endpoint.
 */
@Module({
    controllers: [HealthController],
})
export class HealthCheckModule {}
