import { z } from 'zod';

export const input = z.object({
    config: z.string().optional().describe('The path to a custom Vendure config file'),
});

export const output = z.object({
    reverted: z.boolean(),
    migration: z.string().nullable().optional().describe('The migration that was reverted'),
});
