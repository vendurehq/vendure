import type { ComboboxFreeTextItem } from '@vendure-io/ui/components/molecules/combobox-free-text';

/**
 * Narrows locally sourced suggestions for a free-text combobox. An empty value or an exact
 * item value leaves the full list browsable; other values narrow it to substring matches.
 */
export function filterComboboxFreeTextItems<T extends ComboboxFreeTextItem>(
    items: readonly T[],
    value: string,
): T[] {
    const filter = value.trim().toLowerCase();
    const normalized = (item: T) => item.value.trim().toLowerCase();
    const isUntouched = filter === '' || items.some(item => normalized(item) === filter);
    return items.filter(item => isUntouched || normalized(item).includes(filter));
}
