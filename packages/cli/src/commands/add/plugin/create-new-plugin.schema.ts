import { z } from 'zod';

import { pluginNameRegex } from '../../../constants.js';

export const input = z.object({
    name: z
        .string()
        .regex(pluginNameRegex, 'Use lowercase letters, numbers and dashes, for example reviews')
        .describe('The name of the plugin, for example reviews. The class is named ReviewsPlugin'),
    dir: z
        .string()
        .optional()
        .describe(
            'The directory of the plugin. Leave it empty for a directory next to the existing plugins, or src/plugins',
        ),
    config: z.string().optional().describe('The path to a custom Vendure config file'),
});

export const output = z.object({
    plugin: z.string().describe('The name of the plugin class'),
    dir: z.string(),
    modifiedFiles: z.array(z.string()),
});
