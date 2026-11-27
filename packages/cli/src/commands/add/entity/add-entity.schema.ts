import { z } from 'zod';

import { pascalCaseRegex } from '../../../constants.js';

export const input = z.object({
    name: z
        .string()
        .regex(pascalCaseRegex, 'Use PascalCase, for example ProductReview')
        .describe('The name of the entity class, in PascalCase, for example ProductReview'),
    plugin: z.string().describe('The name of the plugin class to add the entity to'),
    customFields: z.boolean().optional().describe('Let the entity have custom fields'),
    translatable: z.boolean().optional().describe('Give the entity localized properties'),
});

export const output = z.object({
    entity: z.string(),
    plugin: z.string(),
    modifiedFiles: z.array(z.string()),
});
