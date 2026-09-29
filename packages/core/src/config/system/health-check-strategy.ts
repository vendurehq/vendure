import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { HealthIndicatorFunction } from '../../health-check/terminus-compat';

/**
 * @description
 * This strategy defines health checks which, before v3.6.0, were run by the `/health` endpoint.
 * Since v3.6.0 the strategies configured in `systemOptions.healthChecks` are not executed, and this
 * interface will be removed in v4.0.0. See the [health checks guide](/core-concepts/healthchecks/).
 *
 * The example below shows how strategies were configured before v3.6.0.
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
 * @deprecated Not executed since v3.6.0. Use infrastructure-level health checks (e.g. Kubernetes probes, Docker healthchecks,
 * load balancer checks) instead of application-level health checks. This interface will be removed in v4.0.0.
 */
export interface HealthCheckStrategy extends InjectableStrategy {
    /**
     * @description
     * Should return a {@link HealthIndicatorFunction} which performs the check
     * and resolves to a status payload. Since v3.6.0 this method is never called.
     */
    getHealthIndicator(): HealthIndicatorFunction;
}
