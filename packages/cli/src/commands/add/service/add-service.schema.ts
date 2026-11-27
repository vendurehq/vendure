import { z } from 'zod';

import { pascalCaseRegex } from '../../../constants.js';

export const input = z.object({
    name: z
        .string()
        .regex(pascalCaseRegex, 'Use PascalCase, for example ReviewService')
        .describe('The name of the service class, in PascalCase, for example ReviewService'),
    plugin: z.string().describe('The name of the plugin class to add the service to'),
    entity: z
        .string()
        .optional()
        .describe('An entity of the plugin. The service then has CRUD methods for it'),
});

export const output = z.object({
    service: z.string(),
    plugin: z.string(),
    entity: z.string().nullable().describe('The entity the service manages, or null for a basic service'),
    modifiedFiles: z.array(z.string()),
});
