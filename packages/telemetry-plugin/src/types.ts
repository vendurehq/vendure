import { Type } from '@vendure/common/lib/shared-types';

import { OtelLoggerOptions } from './config/otel-logger';
import { MethodHooksForType } from './service/method-hooks.service';

export interface MethodHookConfig<T> {
    target: Type<T>;
    hooks: MethodHooksForType<T>;
}

/**
 * @description
 * Configuration options for the TelemetryPlugin.
 *
 * @since 3.3.0
 * @docsCategory core plugins/TelemetryPlugin
 */
export interface TelemetryPluginOptions {
    /**
     * @description
     * The options for the OtelLogger.
     *
     * For example, to also include logging to the console, you can use the following:
     * ```ts
     * import { LogLevel } from '\@vendure/core';
     * import { TelemetryPlugin } from '\@vendure/telemetry-plugin';
     *
     * TelemetryPlugin.init({
     *     loggerOptions: {
     *         console: LogLevel.Verbose,
     *     },
     * });
     * ```
     */
    loggerOptions?: OtelLoggerOptions;
    /**
     * @description
     * **Status: Developer Preview**
     *
     * This API may change in a future release.
     *
     * Method hooks allow you to add extra telemetry actions to specific methods.
     * To define hooks on a method, use the {@link registerMethodHooks} function.
     *
     * @example
     * ```ts
     * import { TelemetryPlugin, registerMethodHooks } from '\@vendure/telemetry-plugin';
     *
     * TelemetryPlugin.init({
     *   methodHooks: [
     *     registerMethodHooks(ProductService, {
     *
     *       // Define some hooks for the `findOne` method
     *       findOne: {
     *         // This will be called before the method is executed
     *         pre: ({ args: [ctx, productId], span }) => {
     *           span.setAttribute('productId', productId);
     *         },
     *         // This will be called after the method is executed
     *         post: ({ result, span }) => {
     *           span.setAttribute('found', !!result);
     *         },
     *       },
     *     }),
     *   ],
     * });
     * ```
     *
     * @experimental
     */
    methodHooks?: Array<MethodHookConfig<any>>;
}
