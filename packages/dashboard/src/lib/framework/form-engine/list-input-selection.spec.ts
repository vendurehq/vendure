import { ConfigurableFieldDef } from '@/vdb/framework/form-engine/form-engine-types.js';
import { describe, expect, it } from 'vitest';

import { selectListInputComponent } from './list-input-selection.js';

const field = (over: Partial<ConfigurableFieldDef>) =>
    ({ name: 'test', list: true, ...over }) as ConfigurableFieldDef;

describe('selectListInputComponent', () => {
    // String lists must use the tag-style StringListInput, which owns the whole
    // array. Routing them through ConfigurableOperationListInput dropped
    // numeric-looking values ("3249"), whose JSON form parses back to a number.
    it('routes string lists to StringListInput in both value modes', () => {
        expect(selectListInputComponent(field({ type: 'string' }), 'json-string')).toBe('string');
        expect(selectListInputComponent(field({ type: 'string' }), 'native')).toBe('string');
    });

    it('routes non-string json-string lists to the configurable-operation input', () => {
        expect(selectListInputComponent(field({ type: 'int' }), 'json-string')).toBe(
            'configurable-operation',
        );
        expect(selectListInputComponent(field({ type: 'relation' }), 'json-string')).toBe(
            'configurable-operation',
        );
    });

    it('routes native relation lists to the relation input', () => {
        expect(selectListInputComponent(field({ type: 'relation' }), 'native')).toBe('relation');
    });

    it('falls back to the custom-field list input for other native scalar lists', () => {
        expect(selectListInputComponent(field({ type: 'int' }), 'native')).toBe('custom-field');
        expect(selectListInputComponent(field({ type: 'boolean' }), 'native')).toBe('custom-field');
    });
});
