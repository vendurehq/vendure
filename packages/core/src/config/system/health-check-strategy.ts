import { HealthIndicatorFunction } from '@nestjs/terminus';

import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * This strategy defines health checks which are included as part of the
 * `/health` endpoint. They should only be used to monitor _critical_ systems
 * on which proper functioning of the Vendure server depends.
 *
 * For more information on the underlying mechanism, see the
 * [NestJS Terminus module docs](https://docs.nestjs.com/recipes/terminus).
 *
 * Custom strategies should be added to the `systemOptions.healthChecks` array.
 * By default, Vendure includes the `TypeORMHealthCheckStrategy`, so if you set the value of the `healthChecks`
 * array, be sure to include it manually.
 *
 * Vendure also ships with the {@link HttpHealthCheckStrategy}, which is convenient
 * for adding a health check dependent on an HTTP ping.
 *
 * :::info
 *
 * This is configured via the `systemOptions.healthChecks` property of
 * your VendureConfig.
 *
 * :::
 *
 *
 * @example
 * ```ts
 * import { HttpHealthCheckStrategy, TypeORMHealthCheckStrategy } from '\@vendure/core';
 * import { MyCustomHealthCheckStrategy } from './config/custom-health-check-strategy';
 *
 * export const config = {
 *   // ...
 *   systemOptions: {
 *     healthChecks: [
 *       new TypeORMHealthCheckStrategy(),
 *       new HttpHealthCheckStrategy({ key: 'my-service', url: 'https://my-service.com' }),
 *       new MyCustomHealthCheckStrategy(),
 *     ],
 *   },
 * };
 * ```
 *
 * @docsCategory health-check
 * @deprecated Use infrastructure-level health checks (e.g. Kubernetes probes, Docker healthchecks,
 * load balancer checks) instead of application-level health checks. This interface will be removed in v4.0.0.
 */
export interface HealthCheckStrategy extends InjectableStrategy {
    /**
     * @description
     * Should return a `HealthIndicatorFunction`, as defined by the
     * [NestJS Terminus module](https://docs.nestjs.com/recipes/terminus).
     */
    getHealthIndicator(): HealthIndicatorFunction;
}
