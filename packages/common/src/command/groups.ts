import { isErrorResult, isFailedResult, isIncompleteResult } from './define';
import {
    CommandCliMetadata,
    CommandContext,
    CommandDefinition,
    CommandErrorDefinition,
    CommandExtensionDefinition,
    CommandExtensionNextFn,
    CommandGroupDefinition,
    CommandRunResult,
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
            cli: mergeCli(
                own.map(group => group.cli),
                command.cli,
            ),
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

/**
 * @description
 * The extensions a package's declarations module exports as `extensions`, or none. A CommonJS
 * module's exports can arrive as the default export of `import()`, so `default` is read too.
 *
 * @since 4.0.0
 */
export function extensionDeclarations(declarationsModule: unknown): CommandExtensionDefinition[] {
    const mod = (declarationsModule ?? {}) as { extensions?: unknown; default?: unknown };
    const fallback = (mod.default ?? {}) as { extensions?: unknown };
    const extensions = mod.extensions ?? fallback.extensions ?? [];
    if (!Array.isArray(extensions)) {
        throw new Error('The module exports "extensions" that is not a list');
    }
    return extensions as CommandExtensionDefinition[];
}

/**
 * @description
 * A command with extensions applied, outermost first. The host uses it when it runs an extended
 * command, so every part sees what the manifest lists:
 *
 * - The input schema validates each part with its own schema: each extension's fields with the
 *   extension's, the rest with the command's.
 * - The consents, errors and CLI metadata include the extensions'.
 * - `run()` calls the outermost extension's `run(input, ctx, next)`. `next` runs the next one,
 *   or the command, with the command's fields only. `plan()` is the command's, with its own fields.
 *
 * It throws for an extension of another path, and for a consent or error code that two parts declare.
 *
 * @since 4.0.0
 */
export function applyCommandExtensions(
    command: CommandDefinition,
    extensions: CommandExtensionDefinition[],
    /** The package of each extension, in the same order, for the errors that name it. */
    packages: string[] = [],
): CommandDefinition {
    if (extensions.length === 0) {
        return command;
    }
    const key = command.path.join(' ');
    const labelOf = (index: number) =>
        packages[index]
            ? `the extension of "${key}" from ${packages[index]}`
            : `extension ${index + 1} of "${key}"`;
    const commandCliKeys = new Set([
        ...Object.keys(command.cli?.flags ?? {}),
        ...Object.keys(command.cli?.fields ?? {}),
    ]);
    extensions.forEach((extension, index) => {
        for (const [field, meta] of Object.entries(extension.cli?.fields ?? {})) {
            // Only an extension sets an internal field, through next(), so its own never gets a value.
            if (meta.internal) {
                throw new Error(`${labelOf(index)} marks its own field "${field}" internal`);
            }
        }
        for (const field of [
            ...Object.keys(extension.cli?.flags ?? {}),
            ...Object.keys(extension.cli?.fields ?? {}),
        ]) {
            if (commandCliKeys.has(field)) {
                throw new Error(`${labelOf(index)} has CLI metadata for "${field}", which is the command's`);
            }
        }
    });
    const consents: Record<string, string> = { ...command.consents };
    const errors: CommandErrorDefinition[] = [...(command.errors ?? [])];
    for (const extension of extensions) {
        if (extension.path.join(' ') !== key) {
            throw new Error(`An extension of "${extension.path.join(' ')}" was applied to "${key}"`);
        }
        for (const [name, description] of Object.entries(extension.consents ?? {})) {
            if (name in consents) {
                throw new Error(`Two parts of "${key}" declare the consent "${name}"`);
            }
            consents[name] = description;
        }
        for (const error of extension.errors ?? []) {
            if (errors.some(other => other.code === error.code)) {
                throw new Error(`Two parts of "${key}" declare the error "${error.code}"`);
            }
            errors.push(error);
        }
    }
    let loading: Promise<ExtensionParts> | undefined;
    const parts = () => (loading ??= loadExtensionParts(command, extensions, labelOf));
    const omitExtensionFields = (input: Record<string, unknown>, loaded: ExtensionParts) =>
        Object.fromEntries(Object.entries(input).filter(([field]) => !loaded.allInputFields.has(field)));
    const commandPlan = command.plan;
    return {
        ...command,
        consents,
        errors,
        cli: mergeCli(
            extensions.map(extension => extension.cli),
            command.cli,
        ),
        schemas: async () => {
            const loaded = await parts();
            return {
                ...loaded.command,
                input: combineInputs(command.path, [
                    ...loaded.extensions.map((schemas, index) => ({
                        label: labelOf(index),
                        schema: schemas.input,
                    })),
                    { label: `the command "${key}"`, schema: loaded.command.input },
                ]),
            };
        },
        ...(commandPlan
            ? {
                  plan: async () => {
                      const [{ plan }, loaded] = await Promise.all([commandPlan(), parts()]);
                      return {
                          plan: (input: Record<string, unknown>, ctx: CommandContext) =>
                              plan(omitExtensionFields(input, loaded), ctx),
                      };
                  },
              }
            : {}),
        run: async () => {
            const loaded = await parts();
            const [{ run: commandRun }, ...extensionRuns] = await Promise.all([
                command.run(),
                ...extensions.map(extension => extension.run()),
            ]);
            return {
                run: async (input: Record<string, unknown>, ctx: CommandContext) => {
                    const call = async (
                        index: number,
                        commandInput: Record<string, unknown>,
                        context: CommandContext,
                    ): Promise<CommandRunResult<unknown>> => {
                        if (index === extensionRuns.length) {
                            return commandRun(commandInput, context);
                        }
                        const ownFields = loaded.inputFields[index];
                        const extensionInput = {
                            ...commandInput,
                            ...Object.fromEntries(
                                Object.entries(input).filter(([field]) => ownFields.has(field)),
                            ),
                        };
                        const next: CommandExtensionNextFn = async (changes, options) => {
                            // The changes apply to the command's input this extension was called with.
                            const given =
                                changes === undefined
                                    ? commandInput
                                    : await validated(
                                          loaded.command.input,
                                          { ...commandInput, ...omitExtensionFields(changes, loaded) },
                                          `The input that ${labelOf(index)} gave next()`,
                                      );
                            const scope = scopedContext(context, options?.signal);
                            try {
                                return await call(index + 1, given, scope.ctx);
                            } finally {
                                scope.dispose();
                            }
                        };
                        const result = await extensionRuns[index].run(extensionInput, context, next);
                        await checkOutput(result, index, loaded, labelOf(index));
                        return result;
                    };
                    return call(0, omitExtensionFields(input, loaded), ctx);
                },
            };
        },
    };
}

interface ExtensionParts {
    command: Awaited<ReturnType<CommandDefinition['schemas']>>;
    extensions: Array<Awaited<ReturnType<CommandExtensionDefinition['schemas']>>>;
    /** The input fields of each extension, in order. */
    inputFields: Array<Set<string>>;
    allInputFields: Set<string>;
    /** The output fields of each extension, in order. */
    outputFields: Array<Set<string>>;
}

async function loadExtensionParts(
    command: CommandDefinition,
    extensions: CommandExtensionDefinition[],
    labelOf: (index: number) => string,
): Promise<ExtensionParts> {
    const [commandSchemas, ...extensionSchemas] = await Promise.all([
        command.schemas(),
        ...extensions.map(extension => extension.schemas()),
    ]);
    const inputFields = extensionSchemas.map(
        schemas =>
            new Set(
                Object.keys(
                    propertiesOf(schemas.input['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET })),
                ),
            ),
    );
    const outputFields = extensionSchemas.map(
        schemas =>
            new Set(
                schemas.output
                    ? Object.keys(
                          propertiesOf(
                              schemas.output['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET }),
                          ),
                      )
                    : [],
            ),
    );
    // An extension's CLI metadata is for its own fields only, so it never changes how the command's
    // own fields are read, and the manifest and the run agree on every field.
    extensions.forEach((extension, index) => {
        const keys = [
            ...Object.keys(extension.cli?.flags ?? {}),
            ...Object.keys(extension.cli?.fields ?? {}),
        ];
        const foreign = keys.find(field => !inputFields[index].has(field));
        if (foreign) {
            throw new Error(
                `${labelOf(index)} has CLI metadata for "${foreign}", which is not one of its fields`,
            );
        }
    });
    return {
        command: commandSchemas,
        extensions: extensionSchemas,
        inputFields,
        allInputFields: new Set(inputFields.flatMap(fields => [...fields])),
        outputFields,
    };
}

/** The value a schema gives for `value`, or an error that names the issues and their fields. */
async function validated(
    schema: StandardSchema,
    value: Record<string, unknown>,
    label: string,
): Promise<Record<string, unknown>> {
    const result = await schema['~standard'].validate(value);
    if (result.issues) {
        const issues = result.issues.map(issue => {
            const field = issue.path
                ?.map(segment => (typeof segment === 'object' ? String(segment.key) : String(segment)))
                .join('.');
            return field ? `${field}: ${issue.message}` : issue.message;
        });
        throw new Error(`${label} is not valid: ${issues.join('; ')}`);
    }
    return result.value as Record<string, unknown>;
}

/**
 * Checks the ok output an extension returned: its own fields with its output schema, the rest with
 * the command's. Fields of other extensions are left to them. A `failed()`, `incomplete()` or
 * `fail()` result passes as it is, so an extension that passes one on never makes a run fail in a
 * new way. The host reports an invalid output as an internal error, naming the extension.
 */
async function checkOutput(
    result: CommandRunResult<unknown>,
    index: number,
    loaded: ExtensionParts,
    label: string,
): Promise<void> {
    if (isIncompleteResult(result) || isErrorResult(result) || isFailedResult(result)) {
        return;
    }
    const output = result;
    if (output === null || typeof output !== 'object') {
        return;
    }
    const entries = Object.entries(output as Record<string, unknown>);
    const otherExtensionFields = new Set(
        loaded.outputFields.flatMap((fields, other) => (other === index ? [] : [...fields])),
    );
    const own = loaded.outputFields[index];
    const extensionOutput = loaded.extensions[index].output;
    if (extensionOutput) {
        await validated(
            extensionOutput,
            Object.fromEntries(entries.filter(([field]) => own.has(field))),
            `The output fields of ${label}`,
        );
    }
    if (loaded.command.output) {
        await validated(
            loaded.command.output,
            Object.fromEntries(
                entries.filter(([field]) => !own.has(field) && !otherExtensionFields.has(field)),
            ),
            `The command's output that ${label} returned`,
        );
    }
}

/**
 * The context for a call of `next`: the same as the outer one, except that its `ctx.signal` also
 * fires when `signal` does. `dispose` stops listening for either.
 */
function scopedContext(
    ctx: CommandContext,
    signal: AbortSignal | undefined,
): { ctx: CommandContext; dispose: () => void } {
    if (!signal) {
        return { ctx, dispose: () => undefined };
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (ctx.signal.aborted || signal.aborted) {
        controller.abort();
    }
    ctx.signal.addEventListener('abort', abort, { once: true });
    signal.addEventListener('abort', abort, { once: true });
    return {
        ctx: { ...ctx, signal: controller.signal },
        dispose: () => {
            ctx.signal.removeEventListener('abort', abort);
            signal.removeEventListener('abort', abort);
        },
    };
}

function mergeCli(
    parts: Array<Pick<CommandCliMetadata, 'flags' | 'fields'> | undefined>,
    cli: CommandCliMetadata | undefined,
): CommandCliMetadata {
    const merged: CommandCliMetadata = { ...cli };
    for (const part of [...parts, cli]) {
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
