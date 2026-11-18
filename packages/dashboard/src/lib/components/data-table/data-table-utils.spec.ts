import { describe, expect, it } from 'vitest';

import { getColumnVisibility } from './data-table-utils.js';

const columns = ['id', 'createdAt', 'updatedAt', 'name', 'code'].map(id => ({ id, accessorKey: id }));

describe('getColumnVisibility', () => {
    it('treats an empty defaults map like no defaults', () => {
        const visibility = getColumnVisibility(columns, {});
        expect(visibility).toEqual(getColumnVisibility(columns));
        expect(visibility).toMatchObject({ id: false, createdAt: false, updatedAt: false });
        expect(visibility.name).toBeUndefined();
    });

    it('hides custom fields when the defaults map is empty', () => {
        expect(getColumnVisibility(columns, {}, ['customField'])).toMatchObject({ customField: false });
    });

    it('hides every other column when all defaults are true', () => {
        expect(getColumnVisibility(columns, { name: true })).toMatchObject({
            id: false,
            createdAt: false,
            updatedAt: false,
            name: true,
            code: false,
        });
    });

    it('shows every other column when all defaults are false', () => {
        expect(getColumnVisibility(columns, { name: false })).toMatchObject({
            id: true,
            createdAt: true,
            updatedAt: true,
            name: false,
            code: true,
        });
    });

    it('applies only the given values for a mixed map', () => {
        expect(getColumnVisibility(columns, { name: true, code: false })).toMatchObject({
            id: false,
            createdAt: false,
            updatedAt: false,
            name: true,
            code: false,
        });
    });
});
