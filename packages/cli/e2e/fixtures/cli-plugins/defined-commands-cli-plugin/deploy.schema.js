import { z } from 'zod';

export const input = z.object({
    environment: z.string().default('staging').describe('The environment to deploy to'),
});

export const output = z.object({ deployed: z.string() });
