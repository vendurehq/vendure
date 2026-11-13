import { describe, expect, it } from 'vitest';

import { CustomFieldConfig } from '../../config/custom-field/custom-field-types';

import { isStoredCustomFieldValue } from './custom-field-processing-interceptor';

describe('isStoredCustomFieldValue()', () => {
    const field = (config: Partial<CustomFieldConfig>) => ({ name: 'field', ...config }) as CustomFieldConfig;

    it('compares a relation by id', () => {
        const relation = field({ type: 'relation' });

        expect(isStoredCustomFieldValue(relation, '2', { id: 2 })).toBe(true);
        expect(isStoredCustomFieldValue(relation, '3', { id: 2 })).toBe(false);
        expect(isStoredCustomFieldValue(relation, null, null)).toBe(true);
        expect(isStoredCustomFieldValue(relation, null, { id: 2 })).toBe(false);
        expect(isStoredCustomFieldValue(relation, '2', null)).toBe(false);
    });

    it('compares a list relation by ids, in any order', () => {
        const relation = field({ type: 'relation', list: true });

        expect(isStoredCustomFieldValue(relation, ['2', '1'], [{ id: 1 }, { id: 2 }])).toBe(true);
        expect(isStoredCustomFieldValue(relation, ['1'], [{ id: 1 }, { id: 2 }])).toBe(false);
        expect(isStoredCustomFieldValue(relation, [], null)).toBe(true);
    });

    it('treats a stored 0 or 1 as a boolean', () => {
        const boolean = field({ type: 'boolean' });

        expect(isStoredCustomFieldValue(boolean, false, 0)).toBe(true);
        expect(isStoredCustomFieldValue(boolean, true, 1)).toBe(true);
        expect(isStoredCustomFieldValue(boolean, true, 0)).toBe(false);
    });

    it('compares a struct without regard to key order', () => {
        const struct = field({ type: 'struct', fields: [] } as any);

        expect(isStoredCustomFieldValue(struct, { long: 'a', b: 'b' }, { b: 'b', long: 'a' })).toBe(true);
        expect(isStoredCustomFieldValue(struct, { long: 'a', b: 'b' }, { b: 'c', long: 'a' })).toBe(false);
    });

    it('compares a datetime by instant', () => {
        const datetime = field({ type: 'datetime' });
        const date = new Date('2026-01-01T10:00:00.000Z');

        expect(isStoredCustomFieldValue(datetime, new Date(date), date)).toBe(true);
        expect(isStoredCustomFieldValue(datetime, new Date('2026-01-02T10:00:00.000Z'), date)).toBe(false);
    });

    it('treats undefined and null as equal', () => {
        const string = field({ type: 'string' });

        expect(isStoredCustomFieldValue(string, null, undefined)).toBe(true);
        expect(isStoredCustomFieldValue(string, 'a', null)).toBe(false);
    });
});
