import { HealthIndicatorFunction } from './terminus-compat';

/**
 * @description
 * This service is used to register health indicator functions which, before v3.6.0, were run by the
 * `/health` endpoint. Since v3.6.0 registered indicators are not executed, and this service will be
 * removed in v4.0.0. See the [health checks guide](/core-concepts/healthchecks/).
 *
 * The example below shows how a plugin registered an indicator before v3.6.0:
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
     * Registers one or more {@link HealthIndicatorFunction}s. Since v3.6.0 the registered functions are never called.
     *
     * @deprecated Use infrastructure-level health checks instead. This method will be removed in v4.0.0.
     */
    registerIndicatorFunction(fn: HealthIndicatorFunction | HealthIndicatorFunction[]) {
        const fnArray = Array.isArray(fn) ? fn : [fn];
        this._healthIndicatorFunctions.push(...fnArray);
    }
}
