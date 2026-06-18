import { Injectable } from '@nestjs/common';
import { Span } from '@opentelemetry/api';
import { Type } from '@vendure/common/lib/shared-types';
import { getInstrumentedClassTarget, Logger } from '@vendure/core';

import { MethodHookConfig } from '../types';

/**
 * Extracts only the method names from a class type T
 */
export type MethodNames<T> = {
    // eslint-disable-next-line @typescript-eslint/ban-types
    [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

export type Unwrap<T> = T extends Promise<infer U> ? U : T;

type MethodType<T, K extends keyof T> = T[K] extends (...args: any[]) => any ? T[K] : never;

export interface InstrumentedMethodHooks<T, Method extends MethodNames<T>> {
    pre?: (input: { instance: T; args: Parameters<MethodType<T, Method>>; span: Span }) => void;
    post?: (input: {
        instance: T;
        args: Parameters<MethodType<T, Method>>;
        result: Unwrap<ReturnType<MethodType<T, Method>>>;
        span: Span;
    }) => void;
}

export type MethodHooksForType<T> = {
    [K in MethodNames<T>]?: InstrumentedMethodHooks<T, K>;
};

/**
 * @description
 * Allows you to register hooks for a specific method of an instrumented class.
 * These hooks allow extra telemetry actions to be performed on the method.
 *
 * They can then be passed to the {@link TelemetryPlugin} via the {@link TelemetryPluginOptions}.
 *
 * @example
 * ```typescript
 * const productServiceHooks = registerMethodHooks(ProductService, {
 *     findOne: {
 *         // This will be called before the method is executed
 *         pre: ({ args: [ctx, productId], span }) => {
 *             span.setAttribute('productId', productId);
 *         },
 *         // This will be called after the method is executed
 *         post: ({ result, span }) => {
 *             span.setAttribute('found', !!result);
 *         },
 *     },
 * });
 * ```
 *
 * @since 3.3.0
 * @docsCategory core plugins/TelemetryPlugin
 */
export function registerMethodHooks<T>(target: Type<T>, hooks: MethodHooksForType<T>): MethodHookConfig<T> {
    return {
        target,
        hooks,
    };
}

@Injectable()
export class MethodHooksService {
    private hooksMap = new Map<any, { [methodName: string]: InstrumentedMethodHooks<any, any> }>();

    registerHooks<T>(target: Type<T>, hooks: MethodHooksForType<T>): void {
        const instrumentedClassTarget = getInstrumentedClassTarget(target);
        if (!instrumentedClassTarget) {
            Logger.error(`Cannot register hooks for non-instrumented class: ${target.name}`);
            return;
        }
        const existingHooks = this.hooksMap.get(instrumentedClassTarget);
        const combinedHooks = {
            ...existingHooks,
            ...hooks,
        };
        this.hooksMap.set(instrumentedClassTarget, combinedHooks);
    }

    getHooks<T>(target: T, methodName: string): InstrumentedMethodHooks<T, any> | undefined {
        return this.hooksMap.get(target)?.[methodName];
    }
}
