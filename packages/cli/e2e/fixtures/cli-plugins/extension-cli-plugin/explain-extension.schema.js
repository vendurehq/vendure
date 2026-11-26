import { z } from 'zod';

export const input = z.object({
    shout: z.boolean().default(false).describe('Look the request ID up in capitals'),
});

export const output = z.object({
    extendedBy: z.string().describe('The package whose extension ran'),
});
