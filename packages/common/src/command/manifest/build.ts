import fs from 'node:fs';
import path from 'node:path';

import { applyCommandGroups } from '../groups';
import { CommandDefinition, CommandGroupDefinition, JsonSchema } from '../types';

import {
    CommandManifest,
    MANIFEST_FILE_NAME,
    ManifestCommand,
    ManifestGroup,
    mergeManifests,
} from './manifest';

/** @since 4.0.0 */
export interface BuildCommandManifestOptions {
    /**
     * Groups whose shared input applies to the commands they hold. The declarations module exports
     * the same list as `groups`, so the host applies them when it runs a command.
     */
    groups?: CommandGroupDefinition[];
}

const JSON_SCHEMA_TARGET = 'draft-2020-12';

/**
 * Builds the manifest of a package from its command definitions. This is the build step. It
 * loads each command's schemas and turns them into JSON Schema, so the host and the MCP server
 * never need the schema library to know a command's shape.
 */
export async function buildCommandManifest(
    packageName: string,
    version: string,
    definitions: CommandDefinition[],
    options: BuildCommandManifestOptions = {},
): Promise<CommandManifest> {
    const commands: ManifestCommand[] = [];
    for (const def of applyCommandGroups(definitions, options.groups)) {
        const schemas = await def.schemas();
        const input = schemas.input['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET });
        const properties = { ...((input.properties as Record<string, unknown> | undefined) ?? {}) };
        for (const [consent, description] of Object.entries(def.consents ?? {})) {
            properties[consent] = {
                type: 'string',
                description: `The digest of the preview for this consent: ${description}`,
            };
        }
        commands.push({
            path: def.path,
            description: def.description,
            keywords: [...(def.keywords ?? [])],
            behavior: def.behavior,
            requires: def.requires ?? {},
            consents: def.consents ?? {},
            input: { ...input, properties },
            output: withSecretFileFields(
                def.path,
                schemas.output?.['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET }),
                def.secretOutputs ?? [],
            ),
            events: schemas.events?.['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET }),
            cli: {
                flags: def.cli?.flags,
                positional: def.cli?.positional,
                fields: Object.fromEntries(
                    Object.entries(def.cli?.fields ?? {}).map(([field, meta]) => [
                        field,
                        { prompt: meta.prompt, secret: meta.secret, hasChoices: meta.choices !== undefined },
                    ]),
                ),
            },
            errors: (def.errors ?? []).map(error => ({ code: error.code, exit: error.exit })),
            examples: def.examples ?? [],
            expose: { mcp: def.expose?.mcp !== false },
            hasPlan: def.plan !== undefined,
            ...(def.secretOutputs?.length ? { secretOutputs: [...def.secretOutputs] } : {}),
        });
    }
    const groups: ManifestGroup[] = [];
    for (const group of options.groups ?? []) {
        groups.push({
            path: group.path,
            ...(group.description ? { description: group.description } : {}),
            input: (await group.schemas()).input['~standard'].jsonSchema.input({
                target: JSON_SCHEMA_TARGET,
            }),
        });
    }
    const manifest: CommandManifest = {
        manifestVersion: 1,
        package: packageName,
        version,
        commands,
        ...(groups.length ? { groups } : {}),
    };
    // Fails the build on a clash, so a bad declaration never ships.
    mergeManifests([manifest]);
    return manifest;
}

/**
 * The output schema as a caller receives it: a secret output field holds either the value, for a
 * person at a terminal, or the path of the file the host wrote it to.
 */
function withSecretFileFields(
    command: string[],
    output: JsonSchema | undefined,
    fields: string[],
): JsonSchema | undefined {
    if (fields.length === 0) {
        return output;
    }
    // A name that matches no field would leave the real secret in the output, so it fails the build.
    const properties = output?.properties as Record<string, JsonSchema> | undefined;
    const unknown = fields.filter(field => !properties || !(field in properties));
    if (!output || !properties || unknown.length > 0) {
        throw new Error(
            `"${command.join(' ')}" lists secret outputs that are not top-level fields of its output schema: ` +
                unknown.join(', '),
        );
    }
    const secretFile: JsonSchema = {
        type: 'object',
        properties: { secretFile: { type: 'string', description: 'A file only the user can read' } },
        required: ['secretFile'],
    };
    return {
        ...output,
        properties: Object.fromEntries(
            Object.entries(properties).map(([field, schema]) => [
                field,
                fields.includes(field) ? { anyOf: [schema, secretFile] } : schema,
            ]),
        ),
    };
}

/** Writes `vendure-commands.json` into a directory of the package that ships it. */
export async function writeCommandManifest(
    outDir: string,
    packageName: string,
    version: string,
    definitions: CommandDefinition[],
    options: BuildCommandManifestOptions = {},
): Promise<string> {
    const manifest = await buildCommandManifest(packageName, version, definitions, options);
    const file = path.join(outDir, MANIFEST_FILE_NAME);
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
    return file;
}
