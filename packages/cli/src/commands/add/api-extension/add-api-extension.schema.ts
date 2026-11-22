import { z } from 'zod';

/** A GraphQL field name. */
const operationName = z
    .string()
    .regex(
        /^[_A-Za-z][_0-9A-Za-z]*$/,
        'Use letters, numbers and underscores, not starting with a number, for example productReviews',
    );

export const input = z.object({
    plugin: z.string().describe('The name of the plugin class'),
    service: z
        .string()
        .describe('The service the resolver calls. A CRUD service of an entity gets the full CRUD API'),
    queryName: operationName.optional().describe('The name of a query to add. Not used for a CRUD service'),
    mutationName: operationName
        .optional()
        .describe('The name of a mutation to add. Not used for a CRUD service'),
});

export const output = z.object({
    plugin: z.string(),
    service: z.string(),
    resolver: z.string(),
    crud: z.boolean().describe('True when the service is a CRUD service of an entity'),
    modifiedFiles: z.array(z.string()),
});
