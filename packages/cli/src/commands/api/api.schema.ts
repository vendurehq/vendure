import { z } from 'zod';

export const input = z.object({
    target: z
        .enum(['admin', 'shop'])
        .describe(
            'admin: the Admin API, as the superadmin. shop: the Shop API, anonymously, like a storefront',
        ),
    query: z.string().min(1).describe('The GraphQL document'),
    variables: z.string().optional().describe('The variables of the operation, as a JSON object'),
});

const graphqlError = z.object({
    message: z.string(),
    path: z.array(z.union([z.string(), z.number()])).optional(),
    extensions: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('As the server sent them: code, vendureCode and requestId, to pass to vendure explain'),
});

export const output = z.object({
    data: z.record(z.string(), z.unknown()).nullable().optional(),
    errors: z.array(graphqlError).optional(),
});
