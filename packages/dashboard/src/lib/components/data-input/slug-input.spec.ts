import { z } from '@/vdb/lib/zod.js';
import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { requireGeneratedCode, requireGeneratedSlug } from './slug-input.js';

// #5080 — SlugInput generates `code`/`slug` from the name via a debounced server lookup, so the
// field is still blank for a moment after the name is typed. Since #5194 the server rejects a blank
// code or slug, so pages apply these while creating to keep the form invalid — and the Create
// button disabled — until the generated value arrives.
// Both helpers resolve their message through i18n as the rule runs, and the app activates a locale
// at boot (see i18n-provider.tsx). Do the same here or every refinement throws.
beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} });
});

describe('requireGeneratedCode', () => {
    const baseSchema = z.object({ code: z.string(), name: z.string() });

    it('rejects a blank code', () => {
        const result = requireGeneratedCode(baseSchema).safeParse({ code: '', name: 'Materials' });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['code']);
        expect(result.error?.issues[0].message).toBe('This field is required');
    });

    it('accepts a generated code', () => {
        const result = requireGeneratedCode(baseSchema).safeParse({ code: 'materials', name: 'Materials' });

        expect(result.success).toBe(true);
    });

    it('leaves the other generated fields alone', () => {
        const result = requireGeneratedCode(baseSchema).safeParse({ code: 'materials', name: '' });

        expect(result.success).toBe(true);
    });
});

describe('requireGeneratedSlug', () => {
    const baseSchema = z.object({
        translations: z.array(z.object({ languageCode: z.string(), name: z.string(), slug: z.string() })),
    });

    it('rejects a named translation row with a blank slug', () => {
        const result = requireGeneratedSlug(baseSchema).safeParse({
            translations: [{ languageCode: 'en', name: 'Laptop', slug: '' }],
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['translations', 0, 'slug']);
    });

    it('accepts a named translation row with a generated slug', () => {
        const result = requireGeneratedSlug(baseSchema).safeParse({
            translations: [{ languageCode: 'en', name: 'Laptop', slug: 'laptop' }],
        });

        expect(result.success).toBe(true);
    });

    // The form seeds a row for every language the channel has enabled. The user only fills in the
    // one they are working in, and the untouched rows are stripped on submit, so they must not
    // block the Create button.
    it('accepts a seeded row that has no name', () => {
        const result = requireGeneratedSlug(baseSchema).safeParse({
            translations: [
                { languageCode: 'en', name: 'Laptop', slug: 'laptop' },
                { languageCode: 'de', name: '', slug: '' },
            ],
        });

        expect(result.success).toBe(true);
    });

    it('treats a whitespace-only name as unnamed', () => {
        const result = requireGeneratedSlug(baseSchema).safeParse({
            translations: [{ languageCode: 'de', name: '   ', slug: '' }],
        });

        expect(result.success).toBe(true);
    });

    it('treats a whitespace-only slug as blank', () => {
        const result = requireGeneratedSlug(baseSchema).safeParse({
            translations: [{ languageCode: 'en', name: 'Laptop', slug: '   ' }],
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0].path).toEqual(['translations', 0, 'slug']);
    });

    it('reports every offending row, not just the first', () => {
        const result = requireGeneratedSlug(baseSchema).safeParse({
            translations: [
                { languageCode: 'en', name: 'Laptop', slug: '' },
                { languageCode: 'de', name: 'Klapprechner', slug: '' },
            ],
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues.map(issue => issue.path)).toEqual([
            ['translations', 0, 'slug'],
            ['translations', 1, 'slug'],
        ]);
    });

    // Entities whose form has no translations array at all must not blow up the resolver.
    it('does not throw when there are no translations', () => {
        const schema = requireGeneratedSlug(z.object({ name: z.string() }));

        expect(() => schema.safeParse({ name: 'Laptop' })).not.toThrow();
        expect(schema.safeParse({ name: 'Laptop' }).success).toBe(true);
    });
});
