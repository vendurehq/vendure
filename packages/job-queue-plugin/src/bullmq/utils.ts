import { JobFilterParameter } from '@vendure/common/lib/generated-types';

import { BullMQPluginOptions } from './types';

export function getPrefix(options: BullMQPluginOptions) {
    return options.workerOptions?.prefix ?? 'bull';
}

/**
 * Flattens a potentially nested filter (containing `_and` / `_or` arrays)
 * into a single flat object. This is needed because the dashboard UI wraps
 * all column filters in an `_and` array.
 */
export function flattenJobFilter(
    filter: JobFilterParameter | null | undefined,
): Omit<JobFilterParameter, '_and' | '_or'> {
    if (!filter) {
        return {};
    }
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(filter)) {
        if (key === '_and' || key === '_or') {
            if (Array.isArray(value)) {
                for (const nested of value) {
                    Object.assign(result, flattenJobFilter(nested));
                }
            }
        } else {
            result[key] = value;
        }
    }
    return result;
}
