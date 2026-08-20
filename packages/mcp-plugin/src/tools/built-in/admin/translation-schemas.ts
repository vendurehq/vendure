import { LanguageCode } from '@vendure/common/lib/generated-types';
import { z } from 'zod';

import { enumString } from '../enum-string-schema';

export const productTranslationSchema = z.strictObject({
    languageCode: enumString<LanguageCode>(z.string().describe('Language code, e.g. "en".')),
    name: z.string().describe('Product name.').optional(),
    slug: z.string().describe('URL slug.').optional(),
    description: z.string().describe('Product description.').optional(),
});

export const variantTranslationSchema = z.strictObject({
    languageCode: enumString<LanguageCode>(z.string().describe('Language code, e.g. "en".')),
    name: z.string().describe('Variant name.').optional(),
});
