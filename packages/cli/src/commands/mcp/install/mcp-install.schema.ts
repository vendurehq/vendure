import { z } from 'zod';

import { MCP_CLIENTS } from './client-config.js';

export const input = z.object({
    client: z.enum(MCP_CLIENTS).describe('The MCP client to set up'),
    scope: z
        .enum(['project', 'local'])
        .optional()
        .describe(
            'project writes the checked-in config at the git root. local registers the server for this machine only, in Claude Code',
        ),
    print: z.boolean().optional().describe('Print what would be written or run, and change nothing'),
    dir: z
        .string()
        .optional()
        .describe('The Vendure project directory. Found by walking up from the current directory by default'),
});

export const output = z.object({
    client: z.enum(MCP_CLIENTS),
    scope: z.enum(['project', 'local']),
    project: z.string().describe('The Vendure project directory'),
    action: z
        .enum(['created', 'updated', 'unchanged', 'printed', 'registered', 'run-yourself'])
        .describe(
            'What happened: the config file was created, updated or already up to date; the entry was ' +
                'printed; the server was registered with the client; or a command is given to run by hand',
        ),
    file: z.string().nullable().describe('The config file, or null for --scope local'),
    config: z.string().nullable().describe('The config block, when it was printed rather than written'),
    command: z.string().nullable().describe('The client command, for --scope local'),
});
