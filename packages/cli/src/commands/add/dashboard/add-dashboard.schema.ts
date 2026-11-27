import { z } from 'zod';

export const input = z.object({
    plugin: z.string().describe('The name of the plugin class to add Dashboard extensions to'),
});

export const output = z.object({
    plugin: z.string(),
    entrypoint: z.string().describe('The Dashboard entry point of the plugin'),
    modifiedFiles: z.array(z.string()),
});
