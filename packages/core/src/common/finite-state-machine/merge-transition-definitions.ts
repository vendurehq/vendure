import { simpleDeepClone } from '@vendure/common/lib/simple-deep-clone';

import { Transitions } from './types';

/**
 * Merges two state machine Transitions definitions.
 */
export function mergeTransitionDefinitions<A extends string, B extends string>(
    a: Transitions<A>,
    b?: Transitions<B>,
): Transitions<A | B> {
    if (!b) {
        return a as Transitions<A | B>;
    }
    const merged: Transitions<A | B> = simpleDeepClone(a) as any;
    for (const k of Object.keys(b)) {
        const key = k as B;
        if (merged.hasOwnProperty(key)) {
            if (b[key].mergeStrategy === 'replace') {
                merged[key].to = b[key].to;
            } else {
                merged[key].to = merged[key].to.concat(b[key].to);
            }
        } else {
            merged[key] = b[key];
        }
    }
    return merged;
}
