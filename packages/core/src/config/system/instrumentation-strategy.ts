import { Type } from '@vendure/common/lib/shared-types';

import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The arguments that are passed to the `wrapMethod` method of the
 * {@link InstrumentationStrategy} interface.
 *
 * @docsCategory telemetry
 * @since 3.3.0
 */
export interface WrappedMethodArgs {
    /**
     * @description
     * The instance of the class which is being instrumented.
     */
    instance: any;
    /**
     * @description
     * The class which is being instrumented.
     */
    target: Type<any>;
    /**
     * @description
     * The name of the method which is being instrumented.
     */
    methodName: string;
    /**
     * @description
     * The arguments which are passed to the method.
     */
    args: any[];
    /**
     * @description
     * A function which applies the original method and returns the result.
     * This is used to call the original method after the instrumentation has
     * been applied.
     */
    applyOriginalFunction: () => any | Promise<any>;
}

/**
 * @description
 * This interface is used to define a strategy for instrumenting methods of
 * classes which are decorated with the {@link Instrument} decorator.
 *
 * @docsCategory telemetry
 * @since 3.3.0
 */
export interface InstrumentationStrategy extends InjectableStrategy {
    /**
     * @description
     * When a method of an instrumented class is called, it will be wrapped (by means of
     * a Proxy) and this method will be called. The `applyOriginalFunction` function
     * will apply the original method and return the result.
     */
    wrapMethod(args: WrappedMethodArgs): any;
}
