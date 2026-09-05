import { HealthIndicatorFunction } from '../../health-check/terminus-compat';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * This strategy defines health checks which were included as part of the
 * `/health` endpoint.
 *
 * :::warning
 *
 * Since v3.6.0 the strategies configured in `systemOptions.healthChecks` are **no longer
 * executed**: the `/health` endpoint always responds with `{ "status": "ok" }` as soon as the
 * server is accepting requests. Configuring a strategy has no effect on the response, and the
 * whole mechanism will be removed in v4.0.0. Monitor critical dependencies from your
 * infrastructure instead — see the [health check guide](/core-concepts/healthchecks/).
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
     * Retained for backwards compatibility. Since v3.6.0 this method is never
     * called: the `/health` endpoint does not execute the returned
     * {@link HealthIndicatorFunction}.
     */
    getHealthIndicator(): HealthIndicatorFunction;
}
