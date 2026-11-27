import { z } from 'zod';

export const input = z.object({
    name: z.string().describe('Who to greet'),
    shout: z.boolean().default(false).describe('Greet in capitals'),
});

export const output = z.object({ message: z.string() });
