import { z } from 'zod';

import { logLine } from '../devserver/devserver.schema.js';
import { MAX_LOG_LINES } from '../devserver/log-reader.js';

export const input = z.object({
    requestId: z
        .string()
        .min(1)
        .describe(
            'The request ID, from the x-request-id response header or extensions.requestId of a GraphQL error',
        ),
});

export const output = z.object({
    requestId: z.string(),
    found: z.boolean().describe('False when no line of the dev log has this request ID'),
    error: z
        .object({
            code: z.string().describe('The namespaced code, for example core.entity-with-id-not-found'),
            message: z
                .string()
                .describe(
                    'The message as logged, before translation, for example FORBIDDEN: error.forbidden',
                ),
            variables: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('The values for the placeholders of the message key, when logged'),
            stack: z.string().optional().describe('The stack of the error, as logged'),
            process: z.string().optional(),
            ts: z.string(),
        })
        .nullable()
        .describe('The first coded error line of the request, or failing that the first coded warning'),
    logs: z
        .array(logLine)
        .describe(`The lines of the request, oldest first, at most the newest ${MAX_LOG_LINES}`),
    omitted: z.number().describe('How many older lines of the request were left out'),
});
