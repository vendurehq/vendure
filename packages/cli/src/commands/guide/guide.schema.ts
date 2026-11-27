import { z } from 'zod';

export const input = z.object({});

export const output = z.object({
    guide: z.string().describe('The agent guide, as Markdown'),
});
