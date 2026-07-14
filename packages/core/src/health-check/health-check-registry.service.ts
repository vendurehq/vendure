import { HealthIndicatorFunction } from './terminus-compat';

/**
 * @description
 * This service is used to register health indicator functions to be included in the
 * health check. Health checks can be used by automated services such as Kubernetes
 * to determine the state of applications it is running. They are also useful for
 * administrators to get an overview of the health of all the parts of the
 * Vendure stack.
 *
 * Plugins which rely on external services (web services, databases etc.) can make use of this
 * service to add a check for that dependency to the Vendure health check.
 *
 *
 * Since v1.6.0, the preferred way to implement a custom health check is by creating a new {@link HealthCheckStrategy}
 * and then passing it to the `systemOptions.healthChecks` array.
 * See the {@link HealthCheckStrategy} docs for an example configuration.
 *
 * The alternative way to register a health check is by injecting this service directly into your
 * plugin module. To use it in your plugin, you'll need to import the {@link PluginCommonModule}:
 *
 * @example
 * ```ts
 * import { HealthCheckRegistryService, PluginCommonModule, VendurePlugin } from '\@vendure/core';
 *
 * \@VendurePlugin({
 *   imports: [PluginCommonModule],
 * })
 * export class MyPlugin {
 *   constructor(private registry: HealthCheckRegistryService) {
 *     registry.registerIndicatorFunction(async () => ({
 *       'vendure-docs': { status: 'up' },
 *     }));
 *   }
 * }
 * ```
 *
 * @docsCategory health-check
 * @deprecated Use infrastructure-level health checks instead of application-level health checks.
 * This service will be removed in v4.0.0.
 */
export class HealthCheckRegistryService {
    /** @internal */
    get healthIndicatorFunctions(): HealthIndicatorFunction[] {
        return this._healthIndicatorFunctions;
    }
    private _healthIndicatorFunctions: HealthIndicatorFunction[] = [];

    /**
     * @description
     * Registers one or more {@link HealthIndicatorFunction}s to be added to the
     * health check endpoint. The indicator will also appear in the Admin UI's
     * "system status" view.
     *
     * @deprecated Use infrastructure-level health checks instead. This method will be removed in v4.0.0.
     */
    registerIndicatorFunction(fn: HealthIndicatorFunction | HealthIndicatorFunction[]) {
        const fnArray = Array.isArray(fn) ? fn : [fn];
        this._healthIndicatorFunctions.push(...fnArray);
    }
}
