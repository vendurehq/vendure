import type { UseFormReturn } from 'react-hook-form';

import { deepEqual } from '../form-engine/utils.js';

/**
 * The form state which {@link stripUnchangedTranslationRows} compares the update input against.
 */
export interface UnchangedTranslationRowsOptions {
    /** The `translations` of the update input before `transformUpdateInput` ran, as a deep copy. */
    untransformedRows: unknown;
    /** The translation rows the form was loaded with: react-hook-form's `defaultValues.translations`. */
    baselineRows: unknown;
    /** The translation rows currently in the form: `form.getValues('translations')`. */
    currentRows: unknown;
    /** react-hook-form's `dirtyFields.translations`. */
    dirtyRows: unknown;
}

/**
 * Removes the translation rows which this form did not change from an update input, just before
 * the update mutation is sent. The server matches translations by `languageCode` and leaves a
 * language which is absent from the input unchanged. Sending an untouched row would instead write
 * back the values this form loaded, and revert a change saved in another tab in the meantime
 * (#5408).
 *
 * A row is removed only when all of these hold:
 * - the loaded entity has a row for its language;
 * - the form's row for that language equals the loaded row and react-hook-form does not mark it
 *   dirty, so an edit made with `setValue` but without `shouldDirty` still counts as a change;
 * - `transformUpdateInput` did not add or change it.
 *
 * Only the top-level `translations` array is handled. This module is internal and is not exported
 * from the package entry point. Built-in detail pages apply it through
 * {@link dropUnchangedTranslationRows}.
 */
export function stripUnchangedTranslationRows<T>(input: T, options: UnchangedTranslationRowsOptions): T {
    const translations = (input as any)?.translations;
    if (!Array.isArray(translations)) {
        return input;
    }
    const baseline = rowsByLanguage(options.baselineRows);
    if (!baseline.size) {
        return input;
    }
    const current = rowsByLanguage(options.currentRows);
    const untransformed = rowsByLanguage(options.untransformedRows);
    const dirtyRows = Array.isArray(options.dirtyRows) ? options.dirtyRows : [];

    const kept = translations.filter(row => {
        const languageCode = row?.languageCode;
        const loaded = baseline.get(languageCode);
        const inForm = current.get(languageCode);
        const beforeTransform = untransformed.get(languageCode);
        if (!loaded || !inForm || !beforeTransform) {
            return true;
        }
        const changedInForm = isDirty(dirtyRows[inForm.index]) || !deepEqual(inForm.row, loaded.row);
        const changedByTransform = !deepEqual(beforeTransform.row, row);
        return changedInForm || changedByTransform;
    });
    return { ...(input as any), translations: kept };
}

/**
 * Returns a `transformUpdateInput` for a built-in detail page. It runs the page's own `transform`
 * first, then removes the translation rows the form did not change (see
 * {@link stripUnchangedTranslationRows}), so it is the last step before the update mutation is sent.
 *
 * Use it only on a page whose update mutation saves translations through `TranslatableSaver`, which
 * leaves a language that is absent from the input unchanged. `useDetailPage` itself keeps sending
 * every row, because a custom update resolver may replace the stored translations with the input.
 */
export function dropUnchangedTranslationRows(
    getForm: () => UseFormReturn<any>,
    transform?: (input: any) => any,
): <I>(input: I) => I {
    return <I>(input: I): I => {
        const untransformedRows = structuredClone((input as any)?.translations);
        const transformed = transform ? transform(input) : input;
        const form = getForm();
        return stripUnchangedTranslationRows(transformed, {
            untransformedRows,
            baselineRows: (form.formState.defaultValues as any)?.translations,
            currentRows: form.getValues('translations'),
            dirtyRows: (form.formState.dirtyFields as any)?.translations,
        });
    };
}

function rowsByLanguage(rows: unknown): Map<unknown, { row: unknown; index: number }> {
    const result = new Map<unknown, { row: unknown; index: number }>();
    if (!Array.isArray(rows)) {
        return result;
    }
    rows.forEach((row, index) => {
        const languageCode = row?.languageCode;
        if (languageCode != null && !result.has(languageCode)) {
            result.set(languageCode, { row, index });
        }
    });
    return result;
}

function isDirty(value: unknown): boolean {
    if (value != null && typeof value === 'object') {
        return Object.values(value).some(isDirty);
    }
    return value === true;
}
