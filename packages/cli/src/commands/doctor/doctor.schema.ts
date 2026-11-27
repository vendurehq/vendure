import { z } from 'zod';

export const input = z.object({
    config: z.string().optional().describe('The path to a custom Vendure config file'),
    check: z
        .array(z.string())
        .optional()
        .describe('Run these checks only: project, dependencies, config, schema, database'),
    profile: z.string().optional().describe('Run the checks of a profile: production'),
    strict: z.boolean().optional().describe('Treat warnings as failures, which is useful for CI'),
});

const checkResult = z.object({
    name: z.string(),
    status: z.enum(['pass', 'warn', 'fail', 'skip']),
    message: z.string(),
    details: z.array(z.string()).optional(),
    packageManager: z.string().optional(),
});

export const output = z.object({
    vendureVersion: z.string().optional(),
    nodeVersion: z.string(),
    packageManager: z.string().optional(),
    checks: z.array(checkResult),
    overallStatus: z.enum(['passed', 'failed']),
});
