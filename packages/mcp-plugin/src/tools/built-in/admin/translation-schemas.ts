import { LanguageCode } from '@vendure/common/lib/generated-types';
import { z } from 'zod';

import { longText, shortText } from '../string-schemas';

export const productTranslationSchema = z.strictObject({
    languageCode: z.enum(LanguageCode).describe('Language code, e.g. "en".'),
    name: shortText.describe('Product name.').optional(),
    slug: shortText.describe('URL slug.').optional(),
    description: longText.describe('Product description.').optional(),
});

export const variantTranslationSchema = z.strictObject({
    languageCode: z.enum(LanguageCode).describe('Language code, e.g. "en".'),
    name: shortText.describe('Variant name.').optional(),
});
