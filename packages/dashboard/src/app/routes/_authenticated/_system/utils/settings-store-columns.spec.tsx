import { describe, expect, it, vi } from 'vitest';

import { createSettingsStoreColumns, filterSettingsStoreFields } from '../settings-store.js';

describe('Settings Store filters', () => {
    it('renders a label for every table header', () => {
        const labels = { key: 'Key', value: 'Value', scope: 'Scope', readonly: 'Readonly' };
        const columns = createSettingsStoreColumns(labels, vi.fn());

        expect(columns.map(column => column.header)).toEqual(['Key', 'Value', 'Scope', 'Readonly']);
    });

    it('configures only supported generic column filters', () => {
        const labels = { key: 'Key', value: 'Value', scope: 'Scope', readonly: 'Readonly' };
        const columns = createSettingsStoreColumns(labels, vi.fn());
        const [key, currentValue, scopeType, readonly] = columns;

        expect(key.meta).toMatchObject({ fieldInfo: { type: 'String' } });
        expect(currentValue.enableColumnFilter).toBe(false);
        expect(scopeType.enableColumnFilter).toBe(false);
        expect(readonly.enableColumnFilter).toBe(false);
    });

    it('applies a saved key filter to the settings data', () => {
        const fields = [
            { key: 'system.api-key', scopeType: 'GLOBAL', readonly: false, currentValue: null },
            { key: 'dashboard.table-settings', scopeType: 'USER', readonly: false, currentValue: null },
        ] as any;

        expect(
            filterSettingsStoreFields(fields, '', [{ id: 'key', value: { contains: 'dashboard' } }]),
        ).toEqual([fields[1]]);
    });
});
