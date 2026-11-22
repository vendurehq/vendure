import { z } from 'zod';

export const input = z.object({
    name: z
        .string()
        .regex(
            /^[a-zA-Z][a-zA-Z-_0-9]+$/,
            'Use at least two letters, numbers, underscores or dashes, and start with a letter',
        )
        .describe('A name for the migration, for example add-reviews'),
    outputDir: z
        .string()
        .optional()
        .describe(
            'The directory to write the migration to. Defaults to the directory of the migrations ' +
                'the config names, then of an existing migration, then `migrations` next to the ' +
                'config directory',
        ),
    fromEmpty: z
        .boolean()
        .optional()
        .describe(
            'Compare against an empty shadow database, which gives a complete baseline migration even when the database already has tables',
        ),
    config: z.string().optional().describe('The path to a custom Vendure config file'),
});

export const output = z.object({
    file: z
        .string()
        .nullable()
        .describe('The migration file that was written, or null when the schema has no changes'),
    outputDir: z.string(),
});
