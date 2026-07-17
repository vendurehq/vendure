import { ConfigurableFieldDef } from '@/vdb/framework/form-engine/form-engine-types.js';

import { ValueMode } from './value-transformers.js';

export type ListInputComponentKind = 'string' | 'configurable-operation' | 'relation' | 'custom-field';

/**
 * String lists are checked before the json-string mode so they always reach the
 * tag-style StringListInput, which owns the entire array. ConfigurableOperationListInput
 * splits the array into one input per element and loses numeric-looking values.
 */
export function selectListInputComponent(
    fieldDef: ConfigurableFieldDef,
    valueMode: ValueMode,
): ListInputComponentKind {
    if (fieldDef.type === 'string') {
        return 'string';
    }
    if (valueMode === 'json-string') {
        return 'configurable-operation';
    }
    if (fieldDef.type === 'relation') {
        return 'relation';
    }
    return 'custom-field';
}
