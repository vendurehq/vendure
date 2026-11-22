import { z } from 'zod';

export const input = z.object({
    plugin: z.string().describe('The name of the plugin class'),
    service: z.string().describe('The service of the plugin to add the job queue to'),
    name: z
        .string()
        .regex(/^[a-z][a-z-0-9]+$/, 'Use lowercase letters, numbers and dashes, for example review-indexing')
        .describe('The name of the job queue, for example review-indexing'),
});

export const output = z.object({
    plugin: z.string(),
    service: z.string(),
    jobQueue: z.string(),
    triggerMethod: z.string().describe('The service method that adds a job to the queue'),
    modifiedFiles: z.array(z.string()),
});
