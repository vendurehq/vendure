import { LanguageCode } from '@vendure/common/lib/generated-types';
import { z } from 'zod';

export const productTranslationSchema = z.strictObject({
    // Cast is type-only (no runtime effect, schema still emits `type: "string"`): the generated
    // service call expects the real LanguageCode enum, but the JSON schema for this field is a
    // plain string, so z.infer alone would type it as `string`.
    languageCode: z.string().describe('Language code, e.g. "en".') as unknown as z.ZodType<LanguageCode>,
    name: z.string().describe('Product name.').optional(),
    slug: z.string().describe('URL slug.').optional(),
    description: z.string().describe('Product description.').optional(),
});

export const variantTranslationSchema = z.strictObject({
    // Cast is type-only (no runtime effect, schema still emits `type: "string"`): the generated
    // service call expects the real LanguageCode enum, but the JSON schema for this field is a
    // plain string, so z.infer alone would type it as `string`.
    languageCode: z.string().describe('Language code, e.g. "en".') as unknown as z.ZodType<LanguageCode>,
    name: z.string().describe('Variant name.').optional(),
});
