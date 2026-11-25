import type {
    CommandCliMetadata,
    CommandDefinition,
    CommandGroupDefinition,
    JsonSchema,
    StandardSchema,
    StandardSchemaIssue,
    StandardSchemaResult,
} from './types';

const JSON_SCHEMA_TARGET = 'draft-2020-12';

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
    for (const group of groups) {
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
                return { ...schemas, input: combineInputs(command.path, [...groupInputs, schemas.input]) };
            },
            cli: mergeCli(own, command.cli),
        };
    });
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
function combineInputs(commandPath: string[], parts: StandardSchema[]): StandardSchema {
    const jsonParts = parts.map(part => part['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET }));
    const owner = new Map<string, number>();
    jsonParts.forEach((jsonPart, index) => {
        for (const field of Object.keys(propertiesOf(jsonPart))) {
            if (owner.has(field)) {
                throw new Error(
                    `"${commandPath.join(' ')}" declares the field "${field}", which a group of the command already declares`,
                );
            }
            owner.set(field, index);
        }
    });
    const commandIndex = parts.length - 1;
    const combinedJson: JsonSchema = {
        ...jsonParts[commandIndex],
        properties: Object.assign({}, ...jsonParts.map(propertiesOf)),
        required: jsonParts.flatMap(jsonPart => (jsonPart.required as string[] | undefined) ?? []),
    };
    const jsonSchema = () => combinedJson;
    return {
        '~standard': {
            version: 1,
            vendor: 'vendure-command-group',
            validate: async (value: unknown) => {
                const input = (value ?? {}) as Record<string, unknown>;
                const slices = parts.map((_, index) =>
                    Object.fromEntries(
                        Object.entries(input).filter(
                            ([field]) => (owner.get(field) ?? commandIndex) === index,
                        ),
                    ),
                );
                // A Standard Schema may validate synchronously or not, so each result is awaited.
                const results: StandardSchemaResult[] = [];
                for (const [index, part] of parts.entries()) {
                    results.push(await part['~standard'].validate(slices[index]));
                }
                const issues: StandardSchemaIssue[] = results.flatMap(result => result.issues ?? []);
                if (issues.length > 0) {
                    return { issues };
                }
                return {
                    value: Object.assign(
                        {},
                        ...results.map(result => (result as { value: unknown }).value),
                    ) as unknown,
                };
            },
            jsonSchema: { input: jsonSchema, output: jsonSchema },
        },
    };
}
