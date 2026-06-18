import { Span as ApiSpan, SpanStatusCode, trace } from '@opentelemetry/api';
import { Injector, InstrumentationStrategy, VENDURE_VERSION, WrappedMethodArgs } from '@vendure/core';

import { MethodHooksService } from '../service/method-hooks.service';

export const tracer = trace.getTracer('@vendure/core', VENDURE_VERSION);

const recordException = (span: ApiSpan, error: any) => {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
};

export class OtelInstrumentationStrategy implements InstrumentationStrategy {
    private spanAttributeService: MethodHooksService;

    init(injector: Injector) {
        this.spanAttributeService = injector.get(MethodHooksService);
    }

    wrapMethod({ instance, target, methodName, args, applyOriginalFunction }: WrappedMethodArgs) {
        const spanName = `${String(target.name)}.${String(methodName)}`;

        return tracer.startActiveSpan(spanName, {}, span => {
            const hooks = this.spanAttributeService?.getHooks(target, methodName);
            hooks?.pre?.({ args, span, instance });
            if (applyOriginalFunction.constructor.name === 'AsyncFunction') {
                return (
                    applyOriginalFunction()
                        .then((result: any) => {
                            if (hooks?.post) {
                                hooks.post({ args, result, span, instance });
                            }
                            return result;
                        })
                        // @ts-expect-error
                        .catch(error => {
                            recordException(span, error);
                            // Throw error to propagate it further
                            throw error;
                        })
                        .finally(() => {
                            span.end();
                        })
                );
            }

            try {
                const result = applyOriginalFunction();
                if (hooks?.post) {
                    hooks.post({ args, result, span, instance });
                }
                return result;
            } catch (error) {
                recordException(span, error);

                // throw for further propagation
                throw error;
            } finally {
                span.end();
            }
        });
    }
}
