import { z } from 'zod';

export const input = z.object({
    config: z.string().optional().describe('The path to a custom Vendure config file'),
});

export const output = z.object({
    migrationsRan: z.array(z.string()).describe('The migrations that ran, in order'),
    diagnostics: z
        .array(
            z.object({
                code: z.enum(['no-migrations-matched', 'schema-out-of-sync']),
                lines: z.array(z.string()),
            }),
        )
        .describe('Problems found while running, such as a schema that needs a new migration'),
});
