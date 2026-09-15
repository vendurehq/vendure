import { describe, expect, it } from 'vitest';

import { filterComboboxFreeTextItems } from './combobox-free-text-utils.js';

describe('filterComboboxFreeTextItems', () => {
    const items = [
        { value: 'Standard Tax Europe', label: 'Standard Tax Europe' },
        { value: 'Reduced Tax Europe', label: 'Reduced Tax Europe' },
        { value: 'Zero Tax Asia', label: 'Zero Tax Asia' },
    ];
    const values = (result: typeof items) => result.map(item => item.value);

    it('returns every item while the value is empty or blank', () => {
        expect(values(filterComboboxFreeTextItems(items, ''))).toEqual(values(items));
        expect(values(filterComboboxFreeTextItems(items, '   '))).toEqual(values(items));
    });

    it('returns every item while the value is one of them, so a picked value stays browsable', () => {
        expect(values(filterComboboxFreeTextItems(items, 'Standard Tax Europe'))).toEqual(values(items));
    });

    it('ignores case and surrounding whitespace when matching a value against the items', () => {
        expect(values(filterComboboxFreeTextItems(items, '  standard tax europe '))).toEqual(values(items));
        expect(
            values(filterComboboxFreeTextItems([{ value: ' Padded ', label: ' Padded ' }], 'padded')),
        ).toEqual([' Padded ']);
    });

    it('narrows to substring matches once the value is something the user typed', () => {
        expect(values(filterComboboxFreeTextItems(items, 'europe'))).toEqual([
            'Standard Tax Europe',
            'Reduced Tax Europe',
        ]);
        expect(filterComboboxFreeTextItems(items, 'Standard Tax Europe (reverse charge)')).toEqual([]);
    });
});
