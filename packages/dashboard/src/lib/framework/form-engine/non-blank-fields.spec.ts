import type { Control } from 'react-hook-form';
import { describe, expect, it } from 'vitest';
import type { FieldInfo } from '../document-introspection/get-document-structure.js';

import { isNonBlankField, setNonBlankFields } from './non-blank-fields.js';

function field(name: string, extra: Partial<FieldInfo> = {}): FieldInfo {
    return {
        name,
        type: 'String',
        nullable: true,
        list: false,
        isPaginatedList: false,
        isScalar: true,
        ...extra,
    };
}

describe('isNonBlankField', () => {
    const control = {} as Control<any>;
    setNonBlankFields(control, [
        field('code', { nonBlank: true }),
        field('description'),
        field('translations', {
            list: true,
            isScalar: false,
            typeInfo: [field('name', { nonBlank: true }), field('description')],
        }),
    ]);

    it('matches top-level and nested fields, ignoring list indices', () => {
        expect(isNonBlankField(control, 'code')).toBe(true);
        expect(isNonBlankField(control, 'translations.name')).toBe(true);
        expect(isNonBlankField(control, 'translations.2.name')).toBe(true);
    });

    it('does not match other fields or forms', () => {
        expect(isNonBlankField(control, 'description')).toBe(false);
        expect(isNonBlankField(control, 'name')).toBe(false);
        expect(isNonBlankField(control, 'translations.0.description')).toBe(false);
        expect(isNonBlankField({} as Control<any>, 'code')).toBe(false);
        expect(isNonBlankField(undefined, 'code')).toBe(false);
    });
});
