import { z } from 'zod';

export const input = z.object({
    preset: z
        .string()
        .optional()
        .describe('The preset to apply, for example uk. Without it, the presets are listed'),
    country: z
        .string()
        .optional()
        .describe('The country option of the preset, as an ISO 3166-1 alpha-2 code, for example NZ'),
    currency: z
        .string()
        .optional()
        .describe('The currency option of the preset, as an ISO 4217 code, for example NZD'),
    firstRun: z
        .boolean()
        .optional()
        .describe(
            'Apply the preset and scenario recorded in .vendure/create.json, once per database. ' +
                'Returns at once when the database is already seeded',
        ),
    config: z.string().optional().describe('The path to a custom Vendure config file'),
});

const step = z.object({
    status: z
        .enum(['applied', 'already-applied', 'skipped', 'failed'])
        .describe('What happened to this seed'),
    name: z.string().optional(),
    reason: z.string().optional().describe('Why the seed was skipped or failed'),
    created: z
        .record(z.string(), z.number())
        .optional()
        .describe('What the preset created, with a count per entity'),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export const output = z.object({
    presets: z
        .array(
            z.object({
                name: z.string(),
                description: z.string(),
                options: z.record(
                    z.string(),
                    z.object({ description: z.string(), required: z.boolean().optional() }),
                ),
            }),
        )
        .optional()
        .describe('The presets, when no preset was given'),
    preset: step.optional().describe('The preset seed'),
    scenario: step.optional().describe('The scenario seed, with --first-run'),
});

export type SeedInput = z.infer<typeof input>;
export type SeedOutput = z.infer<typeof output>;
export type SeedStep = z.infer<typeof step>;
