import { z } from 'zod';

export const input = z.object({
    plugin: z.string().describe('The name of the plugin class'),
    service: z.string().describe('The service of the plugin to add the job queue to'),
    name: z
        .string()
        .regex(
            /^[A-Za-z][A-Za-z0-9_-]*$/,
            'Use letters, numbers, dashes and underscores, starting with a letter, for example review-indexing',
        )
        .describe('The name of the job queue, for example review-indexing'),
});

export const output = z.object({
    plugin: z.string(),
    service: z.string(),
    jobQueue: z.string(),
    triggerMethod: z.string().describe('The service method that adds a job to the queue'),
    modifiedFiles: z.array(z.string()),
});
