import type { CommandBehavior, JsonSchema } from '@vendure/common/lib/command';
import fs from 'node:fs';
import path from 'node:path';

/** The name of the manifest file a package ships. */
export const MANIFEST_FILE_NAME = 'vendure-commands.json';

/**
 * Field names a command may not use. The host adds `--json`, `--input` and `--format` to every
 * command, and keeps `--yes` and `--project` for host flags that come later.
 */
export const RESERVED_FIELD_NAMES = ['json', 'input', 'format', 'yes', 'project'];

/** Command paths that start with these words belong to the store's tools. */
export const RESERVED_PATH_ROOTS = ['admin', 'shop'];

export interface ManifestCommand {
    path: string[];
    description: string;
    keywords: string[];
    behavior: CommandBehavior;
    requires: { project?: boolean; auth?: string };
    consents: Record<string, string>;
    /** JSON Schema of the input, with one string property for each consent. */
    input: JsonSchema;
    output?: JsonSchema;
    events?: JsonSchema;
    cli: {
        flags?: Record<string, { short?: string; description?: string }>;
        positional?: string[];
        fields?: Record<string, { prompt?: boolean; secret?: boolean; hasChoices?: boolean }>;
    };
    errors: Array<{ code: string; exit: number }>;
    examples: string[];
    expose: { mcp: boolean };
    hasPlan: boolean;
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
 * Finds the manifest that ships with the CLI package. This file is in `dist/command-host`, and
 * the build writes the manifest to `dist`.
 */
export function coreManifestPath(): string {
    return path.join(import.meta.dirname, '..', MANIFEST_FILE_NAME);
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
 * declare, a path that starts with a reserved word, a field that uses a reserved name, and two
 * fields of one command that share a short flag.
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
            const previous = seen.get(key);
            if (previous) {
                throw new Error(
                    `The command ${label} is declared by both ${previous} and ${manifest.package}`,
                );
            }
            seen.set(key, manifest.package);
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

/**
 * Loads the manifests that apply to the current project. Only the CLI's own manifest exists
 * today.
 *
 * `build` writes the CLI's manifest, but `watch` does not. Without the file, the manifest is built
 * from the declarations instead, which loads their schemas and is slower.
 */
export async function loadMergedManifest(
    coreManifestFile: string = coreManifestPath(),
): Promise<MergedManifestCommand[]> {
    if (fs.existsSync(coreManifestFile)) {
        return mergeManifests([readManifestFile(coreManifestFile)]);
    }
    const [{ buildCommandManifest }, { coreCommandDefinitions }] = await Promise.all([
        import('./manifest-build.js'),
        import('./core-commands.js'),
    ]);
    const { name, version } = JSON.parse(
        fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { name: string; version: string };
    return mergeManifests([await buildCommandManifest(name, version, coreCommandDefinitions)]);
}
