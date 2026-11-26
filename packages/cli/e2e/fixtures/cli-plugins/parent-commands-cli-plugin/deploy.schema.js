import { z } from 'zod';

export const input = z.object({
    environment: z.string().default('staging').describe('The environment to deploy to'),
});

export const output = z.object({ ran: z.string(), environment: z.string() });
