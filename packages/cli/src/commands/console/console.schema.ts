import { z } from 'zod';

const dir = z
    .string()
    .optional()
    .describe('The Vendure project directory. Without it, the project is found from the working directory');

const named = z.object({ id: z.string(), name: z.string() });

const linkOutput = z.object({
    outcome: z
        .enum(['linked', 'repaired'])
        .describe('`linked` when this run wrote the link, `repaired` when it kept the one on disk'),
    manifestPath: z.string().describe('The Project Link Manifest, which is safe to commit'),
    project: named.describe('The linked Console Project'),
    account: named.describe('The Customer Account the Project belongs to'),
    plugins: z
        .record(z.string(), z.unknown())
        .describe('What the setup of each CLI plugin reported, by plugin id'),
    nextSteps: z
        .array(z.string())
        .describe('What to do next, such as a step a plugin needs to finish its setup'),
});

export const link = {
    input: z.object({
        dir,
        project: z
            .string()
            .optional()
            .describe(
                'The Console Project to link, by its id or slug. Without it, a person picks one, and a run ' +
                    'without a person links the only Project of the account or asks for this field',
            ),
        organization: z
            .string()
            .optional()
            .describe(
                'Link a project of this organization: its Account identifier (Vendure Console → Settings) or ' +
                    'its name. Signs in again when the CLI login belongs to another organization',
            ),
    }),
    output: linkOutput,
};

export type LinkInput = z.infer<typeof link.input>;
export type LinkOutput = z.infer<typeof linkOutput>;

const statusOutput = z.union([
    z.object({
        linked: z.literal(false),
        manifestPath: z.string().describe('Where the Project Link Manifest would be'),
    }),
    z.object({
        linked: z.literal(true),
        manifestPath: z.string(),
        project: named,
        account: named,
        link: z.object({ id: z.string(), protocolVersion: z.number() }),
        schemaVersion: z.number(),
        consoleUrl: z.string(),
        consoleApiUrl: z.string(),
        telemetry: z
            .object({
                state: z.enum(['off', 'attributed', 'not-attributed']),
                installationId: z.string().optional(),
            })
            .describe('Whether telemetry from this installation is attributed to the linked Project'),
    }),
]);

export const status = {
    input: z.object({ dir }),
    output: statusOutput,
};

export type StatusOutput = z.infer<typeof statusOutput>;

const unlinkOutput = z.object({
    removed: z.boolean().describe('False when the project was not linked'),
    manifestPath: z.string(),
});

export const unlink = {
    input: z.object({ dir }),
    output: unlinkOutput,
};

export type DirInput = z.infer<typeof unlink.input>;
export type UnlinkOutput = z.infer<typeof unlinkOutput>;
