import { getConfig } from '../config/config-helpers';
import { NoopInstrumentationStrategy } from '../config/system/noop-instrumentation-strategy';

export const ENABLE_INSTRUMENTATION_ENV_VAR = 'VENDURE_ENABLE_INSTRUMENTATION';

const INSTRUMENTED_CLASS = Symbol('InstrumentedClassTarget');

type Constructor<T = any> = new (...args: any[]) => T;

/**
 * @description
 * This decorator is used to apply instrumentation to a class. It is intended to be used in conjunction
 * with an {@link InstrumentationStrategy} which defines how the instrumentation should be applied.
 *
 * In order for the instrumentation to be applied, the `VENDURE_ENABLE_INSTRUMENTATION` environment
 * variable (exported from the `@vendure/core` package as `ENABLE_INSTRUMENTATION_ENV_VAR`) must be set to `true`.
 * This is done to avoid the overhead of instrumentation in environments where it is not needed.
 *
 * :::warning
 * You should _not_ decorate GraphQL resolvers & REST controllers with this decorator. Those will
 * already be instrumented, and adding the `@Instrument()` decorator will potentially
 * interfere with other NestJS decorators on your resolver methods.
 * :::
 *
 * For more information on how instrumentation is used, see docs on the TelemetryPlugin.
 *
 * @example
 * ```ts
 * import { Instrument } from '\@vendure/core';
 * import { Injectable } from '\@nestjs/common';
 *
 * \@Injectable()
 * \@Instrument() // [!code highlight]
 * export class MyService {
 *
 *   // Calls to this method will be instrumented
 *   myMethod() {
 *     // ...
 *   }
 * }
 * ```
 *
 * @since 3.3.0
 * @docsCategory telemetry
 */
export function Instrument(): ClassDecorator {
    return function (target: any) {
        // Since the instrumentation is not "free" (it will wrap all instrumented classes in a
        // Proxy, which has some overhead), we will only do this if explicitly requested by the
        // presence of this env var. The `@vendure/telemetry-plugin` package sets this in its configuration,
        // which will be run before any of the Vendure code is loaded.
        if (process.env[ENABLE_INSTRUMENTATION_ENV_VAR] == null) {
            return target;
        }
        // Add type guard to ensure target is a constructor
        if (typeof target !== 'function') {
            return target;
        }
        const InstrumentedClass = class extends (target as Constructor<any>) {
            constructor(...args: any[]) {
                // eslint-disable-next-line constructor-super
                super(...args);
                const config = getConfig();
                const { instrumentationStrategy } = config.systemOptions;
                if (!instrumentationStrategy) {
                    return this;
                }

                if (instrumentationStrategy instanceof NoopInstrumentationStrategy) {
                    throw new Error('Please add a TelemetryPlugin to your VendureConfig');
                }

                // eslint-disable-next-line @typescript-eslint/no-this-alias
                const instance = this;
                const proxy = new Proxy(this, {
                    get: (obj, prop) => {
                        const original = obj[prop as string];
                        if (typeof original === 'function') {
                            // Bind the method to the proxy instance to ensure internal calls go through the proxy
                            const boundMethod = original.bind(proxy);
                            return function (...methodArgs: any[]) {
                                const applyOriginalFunction =
                                    boundMethod.constructor.name === 'AsyncFunction'
                                        ? async () => await boundMethod(...methodArgs)
                                        : () => boundMethod(...methodArgs);
                                const wrappedMethodArgs = {
                                    instance,
                                    target,
                                    methodName: String(prop),
                                    args: methodArgs,
                                    applyOriginalFunction,
                                };
                                return instrumentationStrategy.wrapMethod(wrappedMethodArgs);
                            };
                        }
                        return original;
                    },
                });
                return proxy;
            }
        };

        // Set the name property of ProxiedClass to match the target's name
        Object.defineProperty(InstrumentedClass, 'name', { value: target.name });
        Object.defineProperty(InstrumentedClass, INSTRUMENTED_CLASS, { value: target });

        return InstrumentedClass;
    };
}

/**
 * @description
 * This function is used to retrieve the original class of an instrumented class. It is intended for
 * use in an {@link InstrumentationStrategy} only, and should not generally be used in application code.
 *
 * @since 3.3.0
 */
export function getInstrumentedClassTarget<T>(input: T): T | undefined {
    return input[INSTRUMENTED_CLASS as keyof T] as T | undefined;
}
