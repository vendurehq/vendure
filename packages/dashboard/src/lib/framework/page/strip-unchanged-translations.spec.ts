import { describe, expect, it } from 'vitest';

import {
    dropUnchangedTranslationRows,
    stripUnchangedTranslationRows,
} from './strip-unchanged-translations.js';

const loaded = () => [
    { id: '10', languageCode: 'en', name: 'Chair', description: '<p>A chair</p>' },
    { id: '11', languageCode: 'de', name: 'Stuhl', description: '<p>Ein Stuhl</p>' },
];

/** Builds the options as `useDetailPage` does, from the form rows and the final input rows. */
function strip(
    finalRows: any[] | undefined,
    { current = loaded(), dirty = [] as any[], untransformed = finalRows } = {},
) {
    return stripUnchangedTranslationRows(
        { id: '1', enabled: true, translations: finalRows },
        {
            untransformedRows: structuredClone(untransformed),
            baselineRows: loaded(),
            currentRows: current,
            dirtyRows: dirty,
        },
    ).translations;
}

describe('stripUnchangedTranslationRows', () => {
    // #5408: the stale tab still holds the `de` row it loaded. Only the `en` row it edited is sent, so
    // the `de` name another tab saved in the meantime is not reverted.
    it('drops a row that equals the loaded row and is not dirty', () => {
        const current = [{ ...loaded()[0], name: 'Armchair' }, loaded()[1]];
        expect(strip(current, { current, dirty: [{ name: true }, {}] })).toEqual([
            { id: '10', languageCode: 'en', name: 'Armchair', description: '<p>A chair</p>' },
        ]);
    });

    it('sends no rows when no translation changed', () => {
        expect(strip(loaded())).toEqual([]);
    });

    // An extension may call `setValue` without `shouldDirty`. The row then differs from the loaded
    // row without being dirty, and must still be sent.
    it('keeps a row that differs from the loaded row even when it is not dirty', () => {
        const current = [loaded()[0], { ...loaded()[1], name: 'Neuer Stuhl' }];
        expect(strip(current, { current })).toEqual([
            { id: '11', languageCode: 'de', name: 'Neuer Stuhl', description: '<p>Ein Stuhl</p>' },
        ]);
    });

    it('keeps a dirty row even when it equals the loaded row', () => {
        expect(strip(loaded(), { dirty: [{}, { name: true }] })).toEqual([loaded()[1]]);
    });

    it('keeps a row that transformUpdateInput added for a language the entity has no row for', () => {
        const finalRows = [...loaded(), { languageCode: 'fr', name: 'Chaise' }];
        expect(strip(finalRows, { untransformed: loaded() })).toEqual([
            { languageCode: 'fr', name: 'Chaise' },
        ]);
    });

    it('keeps a loaded row that transformUpdateInput changed', () => {
        const finalRows = [loaded()[0], { ...loaded()[1], slug: 'stuhl' }];
        expect(strip(finalRows, { untransformed: loaded() })).toEqual([{ ...loaded()[1], slug: 'stuhl' }]);
    });

    it('keeps a loaded row that transformUpdateInput added when the input had none for that language', () => {
        expect(strip(loaded(), { untransformed: [loaded()[0]] })).toEqual([loaded()[1]]);
    });

    // Rows are matched by language, so rows without ids are handled like persisted ones.
    it('drops an untouched row that has no id', () => {
        const rows = loaded().map(({ id: _id, ...row }) => row);
        expect(
            stripUnchangedTranslationRows(
                { translations: rows },
                {
                    untransformedRows: structuredClone(rows),
                    baselineRows: structuredClone(rows),
                    currentRows: structuredClone(rows),
                    dirtyRows: [],
                },
            ).translations,
        ).toEqual([]);
    });

    it('leaves an input without a translations array unchanged', () => {
        const input = { id: '1', enabled: false };
        expect(
            stripUnchangedTranslationRows(input, {
                untransformedRows: undefined,
                baselineRows: loaded(),
                currentRows: loaded(),
                dirtyRows: [],
            }),
        ).toBe(input);
    });

    it('keeps every row when the form has no loaded rows to compare with', () => {
        expect(
            stripUnchangedTranslationRows(
                { translations: loaded() },
                {
                    untransformedRows: loaded(),
                    baselineRows: undefined,
                    currentRows: loaded(),
                    dirtyRows: [],
                },
            ).translations,
        ).toEqual(loaded());
    });
});

describe('dropUnchangedTranslationRows', () => {
    /** The parts of a react-hook-form form the wrapper reads, after the user edited the `en` name. */
    const form = () =>
        ({
            formState: {
                defaultValues: { translations: loaded() },
                dirtyFields: { translations: [{ name: true }] },
            },
            getValues: () => [{ ...loaded()[0], name: 'Armchair' }, loaded()[1]],
        }) as any;
    const input = () => ({ id: '1', translations: [{ ...loaded()[0], name: 'Armchair' }, loaded()[1]] });

    it('passes every row to the page transform, then drops the unchanged rows', () => {
        let seen: any[] = [];
        const transform = dropUnchangedTranslationRows(form, i => {
            seen = i.translations;
            return i;
        });
        expect(seen).toEqual([]);
        expect(transform(input()).translations).toEqual([{ ...loaded()[0], name: 'Armchair' }]);
        expect(seen.map(row => row.languageCode)).toEqual(['en', 'de']);
    });

    it('keeps a row that the page transform changed in place', () => {
        const transform = dropUnchangedTranslationRows(form, i => {
            i.translations[1].slug = 'stuhl';
            return i;
        });
        expect(transform(input()).translations.map((row: any) => row.languageCode)).toEqual(['en', 'de']);
    });
});
