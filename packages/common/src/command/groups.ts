import {
    CommandCliMetadata,
    CommandDefinition,
    CommandGroupDefinition,
    JSON_SCHEMA_TARGET,
    JsonSchema,
    StandardSchema,
    StandardSchemaIssue,
    StandardSchemaResult,
} from './types';

function startsWith(path: string[], prefix: string[]): boolean {
    return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}

/** The groups that hold a command, outermost first. */
function groupsOf(command: CommandDefinition, groups: CommandGroupDefinition[]): CommandGroupDefinition[] {
    return groups
        .filter(group => group.path.length < command.path.length && startsWith(command.path, group.path))
        .sort((a, b) => a.path.length - b.path.length);
}

/**
 * @description
 * The commands of a package with the shared input of its groups applied: each command whose path
 * starts with a group's path takes that group's fields as its own, in its input schema, its JSON
 * Schema and its CLI metadata. The manifest build uses it, and so does the host when it loads the
 * declarations to run a command, so both see the same input.
 *
 * Each part of the input is validated with its own schema, the groups' and the command's, and
 * `run()` receives the values of all of them as one object. It throws for a group that holds no
 * command, and, once the schemas load, for a field that a group and a command both declare.
 *
 * @since 4.0.0
 */
export function applyCommandGroups(
    commands: CommandDefinition[],
    groups: CommandGroupDefinition[] = [],
): CommandDefinition[] {
    const paths = new Set<string>();
    for (const group of groups) {
        if (group.path.length === 0) {
            throw new Error(
                'A command group has an empty path, which would give its fields to every command',
            );
        }
        const key = group.path.join(' ');
        if (paths.has(key)) {
            throw new Error(`Two command groups have the path "${key}"`);
        }
        paths.add(key);
        if (!commands.some(command => groupsOf(command, [group]).length > 0)) {
            throw new Error(`The command group "${group.path.join(' ')}" holds no command`);
        }
    }
    return commands.map(command => {
        const own = groupsOf(command, groups);
        if (own.length === 0) {
            return command;
        }
        return {
            ...command,
            schemas: async () => {
                const schemas = await command.schemas();
                const groupInputs = await Promise.all(own.map(async group => (await group.schemas()).input));
                return {
                    ...schemas,
                    input: combineInputs(command.path, [
                        ...own.map((group, index) => ({
                            label: `the group "${group.path.join(' ')}"`,
                            schema: groupInputs[index],
                        })),
                        { label: `the command "${command.path.join(' ')}"`, schema: schemas.input },
                    ]),
                };
            },
            cli: mergeCli(own, command.cli),
        };
    });
}

/**
 * @description
 * The command declarations a package's declarations module exports, with its groups applied: the
 * module's `commands`, with the shared input of its `groups`. A host that runs a package's
 * commands loads them through this, so the shared fields reach `run()`.
 *
 * A CommonJS module's exports can arrive as the default export of `import()`, so `default` is
 * read too.
 *
 * @since 4.0.0
 */
export function commandDeclarations(declarationsModule: unknown): CommandDefinition[] {
    const mod = (declarationsModule ?? {}) as { commands?: unknown; groups?: unknown; default?: unknown };
    const fallback = (mod.default ?? {}) as { commands?: unknown; groups?: unknown };
    const commands = mod.commands ?? fallback.commands;
    const groups = mod.groups ?? fallback.groups ?? [];
    if (!Array.isArray(commands)) {
        throw new Error('The module does not export its commands as "commands"');
    }
    if (!Array.isArray(groups)) {
        throw new Error('The module exports "groups" that is not a list');
    }
    return applyCommandGroups(commands as CommandDefinition[], groups as CommandGroupDefinition[]);
}

function mergeCli(groups: CommandGroupDefinition[], cli: CommandCliMetadata | undefined): CommandCliMetadata {
    const merged: CommandCliMetadata = { ...cli };
    for (const part of [...groups.map(group => group.cli), cli]) {
        if (part?.flags) {
            merged.flags = { ...merged.flags, ...part.flags };
        }
        if (part?.fields) {
            merged.fields = { ...merged.fields, ...part.fields };
        }
    }
    return merged;
}

function propertiesOf(schema: JsonSchema): Record<string, unknown> {
    return (schema.properties as Record<string, unknown> | undefined) ?? {};
}

/**
 * One input schema made of several, the command's last. Each part validates only its own fields;
 * the command's part also gets every field no group declares, so it still rejects or strips an
 * unknown one as it would alone.
 */
function combineInputs(
    commandPath: string[],
    parts: Array<{ label: string; schema: StandardSchema }>,
): StandardSchema {
    const commandIndex = parts.length - 1;
    const owner = new Map<string, number>();
    // The fields are checked once, from the input side, when the schemas load.
    parts
        .map(part => part.schema['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET }))
        .forEach((jsonPart, index) => {
            for (const field of Object.keys(propertiesOf(jsonPart))) {
                const other = owner.get(field);
                if (other !== undefined) {
                    const first = parts[index].label;
                    throw new Error(
                        `${first[0].toUpperCase()}${first.slice(1)} and ${parts[other].label} ` +
                            `both declare the field "${field}"`,
                    );
                }
                owner.set(field, index);
            }
        });
    const combine = (side: 'input' | 'output') => (options: { readonly target: string }) => {
        const jsonParts = parts.map(part => part.schema['~standard'].jsonSchema[side](options));
        const defs: Record<string, unknown> = {};
        for (const jsonPart of jsonParts) {
            // Definitions that `$ref`s point to, as a schema library writes for a shared or
            // recursive schema. Two parts may share one only when it is the same.
            for (const [name, definition] of Object.entries(
                (jsonPart.$defs as Record<string, unknown>) ?? {},
            )) {
                if (name in defs && JSON.stringify(defs[name]) !== JSON.stringify(definition)) {
                    throw new Error(
                        `Two parts of the input of "${commandPath.join(' ')}" define "$defs/${name}" differently`,
                    );
                }
                defs[name] = definition;
            }
        }
        const required = jsonParts.flatMap(jsonPart => (jsonPart.required as string[] | undefined) ?? []);
        const { required: _commandRequired, ...commandPart } = jsonParts[commandIndex];
        return {
            ...commandPart,
            properties: Object.assign({}, ...jsonParts.map(propertiesOf)),
            ...(required.length ? { required } : {}),
            ...(Object.keys(defs).length ? { $defs: defs } : {}),
        } as JsonSchema;
    };
    const merge = (results: StandardSchemaResult[]): StandardSchemaResult => {
        const issues: StandardSchemaIssue[] = results.flatMap(result => result.issues ?? []);
        if (issues.length > 0) {
            return { issues };
        }
        return { value: Object.assign({}, ...results.map(result => (result as { value: unknown }).value)) };
    };
    return {
        '~standard': {
            version: 1,
            vendor: 'vendure-command-group',
            // Synchronous when every part is, as a schema library's own objects are, so a host that
            // checks an answer at a prompt synchronously can still check it.
            validate: (value: unknown) => {
                const input = (value ?? {}) as Record<string, unknown>;
                const results = parts.map((part, index) =>
                    part.schema['~standard'].validate(
                        Object.fromEntries(
                            Object.entries(input).filter(
                                ([field]) => (owner.get(field) ?? commandIndex) === index,
                            ),
                        ),
                    ),
                );
                if (results.some(result => result instanceof Promise)) {
                    return Promise.all(results.map(result => Promise.resolve(result))).then(merge);
                }
                return merge(results as StandardSchemaResult[]);
            },
            jsonSchema: { input: combine('input'), output: combine('output') },
        },
    };
}
