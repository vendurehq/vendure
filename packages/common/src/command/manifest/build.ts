import fs from 'node:fs';
import path from 'node:path';

import { applyCommandGroups } from '../groups';
import {
    CommandCliMetadata,
    CommandDefinition,
    CommandExtensionDefinition,
    CommandGroupDefinition,
    JSON_SCHEMA_TARGET,
    JsonSchema,
} from '../types';

import {
    CommandManifest,
    MANIFEST_FILE_NAME,
    ManifestCommand,
    ManifestExtension,
    ManifestFieldMetadata,
    mergeManifests,
} from './manifest';

/** @since 4.0.0 */
export interface BuildCommandManifestOptions {
    /**
     * Groups whose shared input applies to the commands they hold. Each command's input in the
     * manifest includes their fields. The declarations module exports the same list as `groups`, so
     * the host applies them when it runs a command.
     */
    groups?: CommandGroupDefinition[];
    /**
     * Extensions of commands, the package's own or another package's. The declarations module
     * exports the same list as `extensions`, so the host applies them when it runs the command.
     *
     * @since 4.0.0
     */
    extensions?: CommandExtensionDefinition[];
}

/**
 * An input JSON Schema as the manifest lists it: without the fields marked `internal`, which only
 * an extension sets, and with one string property for each consent.
 */
function manifestInput(
    input: JsonSchema,
    consents: Record<string, string>,
    fields: CommandCliMetadata['fields'],
): JsonSchema {
    const internal = new Set(
        Object.entries(fields ?? {})
            .filter(([, meta]) => meta.internal)
            .map(([field]) => field),
    );
    const properties = Object.fromEntries(
        Object.entries((input.properties as Record<string, unknown> | undefined) ?? {}).filter(
            ([field]) => !internal.has(field),
        ),
    );
    for (const [consent, description] of Object.entries(consents)) {
        properties[consent] = {
            type: 'string',
            description: `The digest of the preview for this consent: ${description}`,
        };
    }
    const required = ((input.required as string[] | undefined) ?? []).filter(field => !internal.has(field));
    const { required: _required, ...rest } = input;
    return { ...rest, properties, ...(required.length ? { required } : {}) };
}

/** The CLI metadata of the fields, as the manifest lists it, without the internal ones. */
function manifestFields(fields: CommandCliMetadata['fields']): Record<string, ManifestFieldMetadata> {
    return Object.fromEntries(
        Object.entries(fields ?? {})
            .filter(([, meta]) => !meta.internal)
            .map(([field, meta]) => [
                field,
                { prompt: meta.prompt, secret: meta.secret, hasChoices: meta.choices !== undefined },
            ]),
    );
}

async function buildExtension(extension: CommandExtensionDefinition): Promise<ManifestExtension> {
    // Only an extension sets an internal field, through next(), so its own never gets a value.
    const internal = Object.entries(extension.cli?.fields ?? {}).find(([, meta]) => meta.internal);
    if (internal) {
        throw new Error(
            `The extension of "${extension.path.join(' ')}" marks its own field "${internal[0]}" internal`,
        );
    }
    const schemas = await extension.schemas();
    const input = schemas.input['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET });
    return {
        path: extension.path,
        input: manifestInput(input, extension.consents ?? {}, extension.cli?.fields),
        ...(schemas.output
            ? { output: schemas.output['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET }) }
            : {}),
        consents: extension.consents ?? {},
        errors: (extension.errors ?? []).map(error => ({ code: error.code, exit: error.exit })),
        cli: {
            flags: extension.cli?.flags,
            fields: manifestFields(extension.cli?.fields),
        },
    };
}

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
        commands.push({
            path: def.path,
            description: def.description,
            keywords: [...(def.keywords ?? [])],
            behavior: def.behavior,
            requires: def.requires ?? {},
            consents: def.consents ?? {},
            input: manifestInput(input, def.consents ?? {}, def.cli?.fields),
            output: withSecretFileFields(
                def.path,
                schemas.output?.['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET }),
                def.secretOutputs ?? [],
            ),
            events: schemas.events?.['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET }),
            cli: {
                flags: def.cli?.flags,
                positional: def.cli?.positional,
                fields: manifestFields(def.cli?.fields),
            },
            errors: (def.errors ?? []).map(error => ({ code: error.code, exit: error.exit })),
            examples: def.examples ?? [],
            expose: { mcp: def.expose?.mcp !== false },
            hasPlan: def.plan !== undefined,
            ...(def.secretOutputs?.length ? { secretOutputs: [...def.secretOutputs] } : {}),
        });
    }
    const extensions = await Promise.all((options.extensions ?? []).map(buildExtension));
    const manifest: CommandManifest = {
        manifestVersion: 1,
        package: packageName,
        version,
        commands,
        ...(extensions.length ? { extensions } : {}),
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
