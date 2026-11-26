import { z } from 'zod';

export const input = z.object({
    environment: z.string().default('staging').describe('The environment to deploy to'),
    force: z.boolean().default(false).describe('Deploy even when nothing changed'),
});

export const output = z.object({ ran: z.string(), environment: z.string() });
