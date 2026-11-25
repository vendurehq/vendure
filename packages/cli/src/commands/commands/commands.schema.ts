import { z } from 'zod';

export const input = z.object({});

export const output = z.object({
    commands: z.array(z.looseObject({ path: z.array(z.string()), source: z.string() })),
});
