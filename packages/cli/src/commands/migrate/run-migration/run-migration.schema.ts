import { z } from 'zod';

export const input = z.object({
    config: z.string().optional().describe('The path to a custom Vendure config file'),
});

export const output = z.object({
    migrationsRan: z.array(z.string()).describe('The migrations that ran, in order'),
    diagnostics: z
        .array(
            z.object({
                // A string, not an enum: the CLI runs the project's own @vendure/core, whose
                // version can report a code this schema does not list.
                code: z.string().describe('For example no-migrations-matched or schema-out-of-sync'),
                lines: z.array(z.string()),
            }),
        )
        .describe('Problems found while running, such as a schema that needs a new migration'),
});
