import { HealthCheckStrategy, HealthIndicatorFunction, Injector } from '@vendure/core';

import { RedisHealthIndicator } from './redis-health-indicator';

/**
 * @deprecated Use infrastructure-level health checks instead of application-level health checks.
 * This class will be removed in v4.0.0.
 */
export class RedisHealthCheckStrategy implements HealthCheckStrategy {
    private indicator!: RedisHealthIndicator;

    init(injector: Injector) {
        this.indicator = injector.get(RedisHealthIndicator);
    }
    getHealthIndicator(): HealthIndicatorFunction {
        return () => this.indicator.isHealthy('redis (job queue)');
    }
}
