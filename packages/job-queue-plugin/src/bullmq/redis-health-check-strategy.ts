import { HealthIndicatorFunction } from '@nestjs/terminus';
import { HealthCheckStrategy, Injector } from '@vendure/core';

import { RedisHealthIndicator } from './redis-health-indicator';

let indicator: RedisHealthIndicator;

/**
 * @deprecated Use infrastructure-level health checks instead of application-level health checks.
 * This class will be removed in v4.0.0.
 */
export class RedisHealthCheckStrategy implements HealthCheckStrategy {
    init(injector: Injector) {
        indicator = injector.get(RedisHealthIndicator);
    }
    getHealthIndicator(): HealthIndicatorFunction {
        return () => indicator.isHealthy('redis (job queue)');
    }
}
