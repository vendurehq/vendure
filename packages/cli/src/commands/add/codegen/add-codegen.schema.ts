import { z } from 'zod';

export const input = z.object({
    plugin: z.string().describe('The name of the plugin class to generate types for'),
});

export const output = z.object({
    plugin: z.string(),
    installed: z.array(z.string()).describe('The package manager commands that ran'),
    modifiedFiles: z.array(z.string()),
    nextSteps: z.array(z.string()),
});
