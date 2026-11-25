import fs from 'node:fs';

import { isValidErrorCode } from '../define';
import { CommandBehavior, CommandCliMetadata, JsonSchema } from '../types';

/** The name of the manifest file a package ships. */
export const MANIFEST_FILE_NAME = 'vendure-commands.json';

/**
 * Field names a command may not use. The host adds `--json`, `--input` and `--format` to every
 * command, and reserves `--yes` for a flag of its own.
 */
export const RESERVED_FIELD_NAMES = ['json', 'input', 'format', 'yes'];

/** Command paths that start with these words belong to the store's tools. */
export const RESERVED_PATH_ROOTS = ['admin', 'shop'];

export interface ManifestCommand {
    path: string[];
    description: string;
    keywords: string[];
    behavior: CommandBehavior;
    requires: { project?: boolean; auth?: 'cloud' };
    consents: Record<string, string>;
    /** JSON Schema of the input, with one string property for each consent. */
    input: JsonSchema;
    output?: JsonSchema;
    events?: JsonSchema;
    cli: {
        flags?: CommandCliMetadata['flags'];
        positional?: string[];
        fields?: Record<string, { prompt?: boolean; secret?: boolean; hasChoices?: boolean }>;
    };
    errors: Array<{ code: string; exit: number }>;
    examples: string[];
    expose: { mcp: boolean };
    hasPlan: boolean;
    /** The output fields that hold a secret, written to a file instead of the output. */
    secretOutputs?: string[];
}

export interface CommandManifest {
    manifestVersion: 1;
    package: string;
    version: string;
    commands: ManifestCommand[];
}

export interface MergedManifestCommand extends ManifestCommand {
    /** The package whose manifest declared the command. */
    source: string;
}

/**
 * Whether a field's JSON Schema is `boolean | string`, either as `anyOf` or as a `type` list. The
 * CLI registers such a field as a flag with an optional value, such as `--inspect [host:port]`,
 * and the generated reference shows it that way.
 *
 * @since 4.0.0
 */
export function takesOptionalValue(schema: JsonSchema): boolean {
    const types = new Set<string>(
        Array.isArray(schema.type)
            ? (schema.type as string[])
            : ((schema.anyOf as JsonSchema[] | undefined) ?? []).map(part => String(part.type)),
    );
    return types.size === 2 && types.has('boolean') && types.has('string');
}

/**
 * How the CLI writes a field's flag, after `--<field>`: the value it takes, such as ` <name>`,
 * ` <path...>` or ` [host:port]`, or nothing for a boolean, and whether it also has `--no-<field>`.
 * The command line and the generated reference both use it, so help and the docs agree.
 *
 * @since 4.0.0
 */
export function flagValueSyntax(
    command: Pick<ManifestCommand, 'cli' | 'consents'>,
    field: string,
    schema: JsonSchema,
    kebabName: string,
): { value: string; negatable: boolean } {
    const placeholder = command.cli.flags?.[field]?.placeholder ?? (field in command.consents ? 'digest' : kebabName);
    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    if (takesOptionalValue(schema)) {
        return { value: ` [${placeholder}]`, negatable: false };
    }
    if (type === 'boolean') {
        return { value: '', negatable: true };
    }
    return { value: type === 'array' ? ` <${placeholder}...>` : ` <${placeholder}>`, negatable: false };
}

export function readManifestFile(file: string): CommandManifest {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf-8')) as CommandManifest;
    if (manifest.manifestVersion !== 1 || !Array.isArray(manifest.commands)) {
        throw new Error(`"${file}" is not a Vendure command manifest`);
    }
    return manifest;
}

/**
 * Merges the manifests of the packages in a project. It refuses a command path that two packages
 * declare, a path that starts with a reserved word, a field that uses a reserved name, two
 * fields of one command that share a short flag, and an error code that is not
 * `<namespace>.<kebab-name>`.
 */
export function mergeManifests(manifests: CommandManifest[]): MergedManifestCommand[] {
    const merged: MergedManifestCommand[] = [];
    const seen = new Map<string, string>();
    for (const manifest of manifests) {
        for (const command of manifest.commands) {
            const key = command.path.join(' ');
            const label = `"${key}"`;
            if (RESERVED_PATH_ROOTS.includes(command.path[0])) {
                throw new Error(
                    `${manifest.package} declares the command ${label}, but "${command.path[0]}" is reserved`,
                );
            }
            // `vendure mcp` names a tool by joining its path with `_`, so a segment with `_` in it
            // could give two commands the same tool name.
            const badSegment = command.path.find(segment => !/^[a-z0-9][a-z0-9-]*$/.test(segment));
            if (badSegment !== undefined) {
                throw new Error(
                    `${manifest.package} declares the command ${label}, but "${badSegment}" is not a lowercase word or words joined with "-"`,
                );
            }
            const previous = seen.get(key);
            if (previous) {
                throw new Error(
                    `The command ${label} is declared by both ${previous} and ${manifest.package}`,
                );
            }
            seen.set(key, manifest.package);
            const badCode = (command.errors ?? []).find(error => !isValidErrorCode(error.code));
            if (badCode) {
                throw new Error(
                    `${manifest.package} declares the command ${label} with the error code "${badCode.code}", which is not <namespace>.<kebab-name>`,
                );
            }
            const properties = Object.keys((command.input.properties as object | undefined) ?? {});
            for (const name of properties) {
                if (RESERVED_FIELD_NAMES.includes(name)) {
                    throw new Error(
                        `The command ${label} declares the field "${name}", which the host reserves`,
                    );
                }
            }
            const shorts = new Map<string, string>();
            for (const [field, flag] of Object.entries(command.cli.flags ?? {})) {
                if (!flag.short) {
                    continue;
                }
                const other = shorts.get(flag.short);
                if (other) {
                    throw new Error(
                        `The command ${label} uses the short flag ${flag.short} for both "${other}" and "${field}"`,
                    );
                }
                shorts.set(flag.short, field);
            }
            merged.push({ ...command, source: manifest.package });
        }
    }
    return merged;
}
