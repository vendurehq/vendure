import { useMemo } from 'react';

import { useLocalFormat } from './use-local-format.js';

export interface SortedLanguage {
    code: string;
    label: string;
}

/**
 * @description
 * This hook takes an array of language codes and returns a sorted array of language objects
 * with code and localized label, sorted alphabetically by the label.
 *
 * @example
 * ```ts
 * const sortedLanguages = useSortedLanguages(['en', 'fr', 'de']);
 * // Returns: [{ code: 'de', label: 'German' }, { code: 'en', label: 'English' }, { code: 'fr', label: 'French' }]
 * ```
 *
 * @param availableLanguages - Array of language codes to sort
 * @returns Sorted array of language objects with code and label
 *
 * @docsCategory hooks
 * @docsPage useSortedLanguages
 * @docsWeight 0
 */
export function useSortedLanguages(availableLanguages?: string[] | null): SortedLanguage[] {
    const { formatLanguageName } = useLocalFormat();

    return useMemo(
        () =>
            (availableLanguages ?? [])
                .map(code => ({
                    code,
                    label: formatLanguageName(code),
                }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [availableLanguages, formatLanguageName],
    );
}
