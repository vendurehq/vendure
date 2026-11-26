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

/**
 * What the manifest says about one input field, for the CLI.
 *
 * @since 4.0.0
 */
export interface ManifestFieldMetadata {
    prompt?: boolean;
    secret?: boolean;
    /** The command computes the valid values, from the project. */
    hasChoices?: boolean;
    /**
     * Only an extension sets the field. The build leaves such a field out of the manifest, so it is
     * never `true` in a manifest a build wrote.
     */
    internal?: boolean;
}

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
        fields?: Record<string, ManifestFieldMetadata>;
    };
    errors: Array<{ code: string; exit: number }>;
    examples: string[];
    expose: { mcp: boolean };
    hasPlan: boolean;
    /** The output fields that hold a secret, written to a file instead of the output. */
    secretOutputs?: string[];
}

/**
 * An extension of a command, as the manifest describes it: the parts it adds to the command.
 *
 * @since 4.0.0
 */
export interface ManifestExtension {
    /** The path of the command it extends. */
    path: string[];
    /** JSON Schema of the input fields it adds, with one string property for each consent. */
    input: JsonSchema;
    /** JSON Schema of the output fields it adds. */
    output?: JsonSchema;
    consents: Record<string, string>;
    errors: Array<{ code: string; exit: number }>;
    cli: {
        flags?: CommandCliMetadata['flags'];
        fields?: Record<string, ManifestFieldMetadata>;
    };
}

export interface CommandManifest {
    manifestVersion: 1;
    package: string;
    version: string;
    commands: ManifestCommand[];
    /**
     * The extensions the package declares of other commands, its own or another package's.
     *
     * @since 4.0.0
     */
    extensions?: ManifestExtension[];
}

export interface MergedManifestCommand extends ManifestCommand {
    /** The package whose manifest declared the command. */
    source: string;
    /**
     * The packages that extend the command, in the order their extensions wrap it, outermost
     * first, with the input fields each adds. The host loads their extensions to run it.
     *
     * @since 4.0.0
     */
    extendedBy?: Array<{ package: string; fields: string[] }>;
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
    const placeholder =
        command.cli.flags?.[field]?.placeholder ?? (field in command.consents ? 'digest' : kebabName);
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
            checkPartRules(command, `${manifest.package} declares the command ${label}`);
            merged.push({ ...command, source: manifest.package });
        }
        for (const extension of manifest.extensions ?? []) {
            checkExtension(manifest.package, extension);
        }
    }
    return merged;
}

/**
 * The rules a command and an extension both follow on their own: field names the host does not
 * reserve, error codes of the right shape, and each short flag used once. `label` names the part,
 * such as `@acme/cli declares the command "acme sync"`.
 */
function checkPartRules(part: Pick<ManifestCommand, 'input' | 'errors' | 'cli'>, label: string): void {
    for (const name of Object.keys((part.input.properties as object | undefined) ?? {})) {
        if (RESERVED_FIELD_NAMES.includes(name)) {
            throw new Error(`${label} with the field "${name}", which the host reserves`);
        }
    }
    const badCode = (part.errors ?? []).find(error => !isValidErrorCode(error.code));
    if (badCode) {
        throw new Error(
            `${label} with the error code "${badCode.code}", which is not <namespace>.<kebab-name>`,
        );
    }
    const shorts = new Map<string, string>();
    for (const [field, flag] of Object.entries(part.cli.flags ?? {})) {
        if (flag.short) {
            const other = shorts.get(flag.short);
            if (other) {
                throw new Error(
                    `${label} that uses the short flag ${flag.short} for both "${other}" and "${field}"`,
                );
            }
            shorts.set(flag.short, field);
        }
    }
}

/**
 * The rules an extension follows on its own, before it is applied: those of {@link checkPartRules},
 * and CLI metadata for its own input fields only.
 */
function checkExtension(packageName: string, extension: ManifestExtension): void {
    if (extension.path.length === 0) {
        throw new Error(`${packageName} declares an extension with an empty path`);
    }
    const label = `${packageName} declares an extension of "${extension.path.join(' ')}"`;
    checkPartRules(extension, label);
    const foreign = foreignCliKey(extension);
    if (foreign) {
        throw new Error(`${label} with CLI metadata for "${foreign}", which is not one of its fields`);
    }
}

/**
 * The `$defs` of two JSON Schemas together, as a schema library writes them for a shared or
 * recursive part that a `$ref` points to. Two may share a name only when the definition is the same.
 */
function mergedDefs(
    a: JsonSchema | undefined,
    b: JsonSchema | undefined,
    key: string,
): Record<string, unknown> {
    const defs: Record<string, unknown> = { ...((a?.$defs as Record<string, unknown> | undefined) ?? {}) };
    for (const [name, definition] of Object.entries(
        (b?.$defs as Record<string, unknown> | undefined) ?? {},
    )) {
        if (name in defs && JSON.stringify(defs[name]) !== JSON.stringify(definition)) {
            throw new Error(`it defines "$defs/${name}" differently from "${key}"`);
        }
        defs[name] = definition;
    }
    return defs;
}

/** A field an extension's CLI metadata names that is not one of its own input fields, if any. */
function foreignCliKey(extension: ManifestExtension): string | undefined {
    const own = (extension.input.properties as Record<string, unknown> | undefined) ?? {};
    return [...Object.keys(extension.cli.flags ?? {}), ...Object.keys(extension.cli.fields ?? {})].find(
        field => !(field in own),
    );
}

/**
 * The command with an extension applied: the extension's input and output fields added to its
 * JSON Schema, its consents, errors and CLI metadata merged in, and the package recorded in
 * `extendedBy`, after the extensions applied before it. It throws, naming the part, for a field,
 * short flag, consent or error code that the command or an earlier extension already has.
 *
 * @since 4.0.0
 */
export function extendManifestCommand(
    command: MergedManifestCommand,
    extension: ManifestExtension,
    packageName: string,
): MergedManifestCommand {
    const key = command.path.join(' ');
    if (extension.path.join(' ') !== key) {
        throw new Error(`An extension of "${extension.path.join(' ')}" was applied to "${key}"`);
    }
    const inputProperties = (command.input.properties as Record<string, unknown> | undefined) ?? {};
    const addedInput = (extension.input.properties as Record<string, unknown> | undefined) ?? {};
    for (const field of Object.keys(addedInput)) {
        if (field in inputProperties) {
            throw new Error(`the input field "${field}" of "${key}" exists already`);
        }
    }
    const outputProperties = (command.output?.properties as Record<string, unknown> | undefined) ?? {};
    const addedOutput = (extension.output?.properties as Record<string, unknown> | undefined) ?? {};
    for (const field of Object.keys(addedOutput)) {
        if (field in outputProperties) {
            throw new Error(`the output field "${field}" of "${key}" exists already`);
        }
    }
    for (const consent of Object.keys(extension.consents)) {
        if (consent in command.consents) {
            throw new Error(`the consent "${consent}" of "${key}" exists already`);
        }
    }
    for (const error of extension.errors) {
        if (command.errors.some(other => other.code === error.code)) {
            throw new Error(`the error "${error.code}" of "${key}" exists already`);
        }
    }
    const takenShorts = new Set(
        Object.values(command.cli.flags ?? {})
            .map(flag => flag.short)
            .filter((short): short is string => short !== undefined),
    );
    for (const flag of Object.values(extension.cli.flags ?? {})) {
        if (flag.short && takenShorts.has(flag.short)) {
            throw new Error(`the short flag ${flag.short} of "${key}" is taken already`);
        }
    }
    // An extension's CLI metadata is for its own fields only. Those are new to the command, so it
    // can never change how the command's own fields are read, here or at run time.
    const foreign = foreignCliKey(extension);
    if (foreign) {
        throw new Error(`its CLI metadata names "${foreign}", which is not one of its fields`);
    }
    const inputDefs = mergedDefs(command.input, extension.input, key);
    const outputDefs =
        command.output || extension.output ? mergedDefs(command.output, extension.output, key) : {};
    const required = [
        ...((command.input.required as string[] | undefined) ?? []),
        ...((extension.input.required as string[] | undefined) ?? []),
    ];
    const outputRequired = [
        ...((command.output?.required as string[] | undefined) ?? []),
        ...((extension.output?.required as string[] | undefined) ?? []),
    ];
    return {
        ...command,
        input: {
            ...command.input,
            properties: { ...inputProperties, ...addedInput },
            ...(required.length ? { required } : {}),
            ...(Object.keys(inputDefs).length ? { $defs: inputDefs } : {}),
        },
        ...(command.output || extension.output
            ? {
                  output: {
                      ...(command.output ?? { type: 'object' }),
                      properties: { ...outputProperties, ...addedOutput },
                      ...(outputRequired.length ? { required: outputRequired } : {}),
                      ...(Object.keys(outputDefs).length ? { $defs: outputDefs } : {}),
                  },
              }
            : {}),
        consents: { ...command.consents, ...extension.consents },
        errors: [...command.errors, ...extension.errors],
        cli: {
            ...command.cli,
            flags: { ...command.cli.flags, ...extension.cli.flags },
            fields: { ...command.cli.fields, ...extension.cli.fields },
        },
        extendedBy: [
            ...(command.extendedBy ?? []),
            {
                package: packageName,
                fields: Object.keys(addedInput).filter(field => !(field in extension.consents)),
            },
        ],
    };
}
