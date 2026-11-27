import { z } from 'zod';

export const input = z.object({
    audience: z.string().optional().describe('Who the command speaks to'),
});
