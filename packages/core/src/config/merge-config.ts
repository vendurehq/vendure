import { isClassInstance, isObject } from '@vendure/common/lib/shared-utils';
import { simpleDeepClone } from '@vendure/common/lib/simple-deep-clone';

import { safeAssign } from '../common/safe-assign';

import { PartialVendureConfig, VendureConfig } from './vendure-config';

/**
 * @description
 * Performs a deep merge of two VendureConfig objects. Unlike `Object.assign()` the `target` object is
 * not mutated, instead the function returns a new object which is the result of deeply merging the
 * values of `source` into `target`.
 *
 * Arrays do not get merged, they are treated as a single value that will be replaced. So if merging the
 * `plugins` array, you must explicitly concatenate the array.
 *
 * @example
 * ```ts
 * const result = mergeConfig(defaultConfig, {
 *   assetOptions: {
 *     uploadMaxFileSize: 5000,
 *   },
 *   plugins: [
 *     ...defaultConfig.plugins,
 *     MyPlugin,
 *   ]
 * };
 * ```
 *
 * @docsCategory configuration
 */
export function mergeConfig<T extends VendureConfig>(target: T, source: PartialVendureConfig, depth = 0): T {
    if (!source) {
        return target;
    }

    if (depth === 0) {
        target = simpleDeepClone(target);
    }

    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            // Guard against prototype pollution - block dangerous property names
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
                continue;
            }

            if (isObject((source as any)[key])) {
                if (!(target as any)[key]) {
                    safeAssign(target, key, {});
                }
                if (!isClassInstance((source as any)[key])) {
                    mergeConfig((target as any)[key], (source as any)[key], depth + 1);
                } else {
                    safeAssign(target, key, (source as any)[key]);
                }
            } else {
                safeAssign(target, key, (source as any)[key]);
            }
        }
    }
    return target;
}
