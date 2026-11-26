import { z } from 'zod';

export const input = z.object({});

export const output = z.object({
    commands: z
        .array(z.looseObject({ path: z.array(z.string()), source: z.string() }))
        .describe("The CLI's own commands and those of the project's enabled plugins, from their manifests"),
    refused: z
        .array(
            z.object({
                package: z.string(),
                error: z.looseObject({ code: z.string(), message: z.string() }),
                kind: z
                    .enum(['commands', 'extensions'])
                    .optional()
                    .describe(
                        "What was left out: the package's commands, the default, or only its extensions of other commands",
                    ),
            }),
        )
        .optional()
        .describe(
            'Enabled plugins whose defineCommand commands or command extensions were left out, each with the coded error that says why',
        ),
});
