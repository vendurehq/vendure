import { describe, expect, it } from 'vitest';

import { getLanguageCodeFromQuery } from './get-language-code';

function requestWithQuery(query: Record<string, unknown>) {
    return { query } as never;
}

describe('getLanguageCodeFromQuery', () => {
    it('returns the languageCode query parameter', () => {
        expect(getLanguageCodeFromQuery(requestWithQuery({ languageCode: 'de' }))).toBe('de');
    });

    it('returns undefined when the parameter is absent', () => {
        expect(getLanguageCodeFromQuery(requestWithQuery({}))).toBeUndefined();
    });

    it('ignores a value that is not a plain language code', () => {
        expect(getLanguageCodeFromQuery(requestWithQuery({ languageCode: "de'; DROP TABLE" }))).toBeUndefined();
        expect(getLanguageCodeFromQuery(requestWithQuery({ languageCode: ['de', 'en'] }))).toBeUndefined();
    });
});
