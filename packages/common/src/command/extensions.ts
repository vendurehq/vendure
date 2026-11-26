import { isErrorResult, isFailedResult, isIncompleteResult } from './define';
import { combineInputs, mergeCli, propertiesOf } from './groups';
import {
    CommandCliMetadata,
    CommandContext,
    CommandDefinition,
    CommandErrorDefinition,
    CommandExtensionDefinition,
    CommandExtensionNextFn,
    CommandRunResult,
    JSON_SCHEMA_TARGET,
    SpawnOptions,
    StandardSchema,
    StandardSchemaResult,
} from './types';

/**
 * @description
 * The names of the fields a command's CLI metadata marks `internal`: those only an extension sets,
 * through `next()`. The manifest leaves them out, and the host removes them from what a caller passes.
 *
 * @since 4.0.0
 */
export function internalFieldsOf(cli: Pick<CommandCliMetadata, 'fields'> | undefined): string[] {
    return Object.entries(cli?.fields ?? {})
        .filter(([, meta]) => meta.internal)
        .map(([field]) => field);
}

/**
 * The names of a command or extension that `commandExtensionViolation` compares. A part leaves
 * out what is not known yet, such as its fields before its schemas load, and the rules that need
 * it are skipped.
 */
export interface CommandPartNames {
    /** The input fields, without the consents. */
    inputFields?: Iterable<string>;
    outputFields?: Iterable<string>;
    /** A command's fields that only an extension sets. */
    internalFields?: Iterable<string>;
    /**
     * The fields an extension marks `internal`, which it may not: only an extension sets one, so
     * its own would never get a value.
     */
    markedInternal?: Iterable<string>;
    /** The fields its `cli.flags` and `cli.fields` name. */
    cliKeys?: Iterable<string>;
    shortFlags?: Iterable<string>;
    consents?: Iterable<string>;
    errorCodes?: Iterable<string>;
}

/**
 * The first rule that an extension of the command `key` breaks, as a phrase such as
 * `the consent "x" of "acme deploy" exists already`, or `undefined`. `command` holds the command
 * with the extensions before this one applied. The build checks an extension against an empty
 * command, the host checks it against the command in the manifest, and again when it runs it.
 *
 * A consent is an input of its own, `--<consent> <digest>`, so a consent and an input field may not
 * share a name, in either direction.
 */
export function commandExtensionViolation(
    key: string,
    command: CommandPartNames,
    extension: CommandPartNames,
): string | undefined {
    return (
        ownViolation(extension) ??
        inputViolation(key, command, extension) ??
        takenViolation(key, command, extension)
    );
}

/** A rule an extension breaks with its own names alone. */
function ownViolation(extension: CommandPartNames): string | undefined {
    const [ownInternal] = extension.markedInternal ?? [];
    if (ownInternal !== undefined) {
        return `it marks its own field "${ownInternal}" internal`;
    }
    if (extension.inputFields === undefined) {
        return undefined;
    }
    const own = new Set(extension.inputFields);
    const foreign = [...(extension.cliKeys ?? [])].find(field => !own.has(field));
    return foreign === undefined
        ? undefined
        : `its CLI metadata names "${foreign}", which is not one of its fields`;
}

/** A rule an extension's input fields or consents break against the command's inputs. */
function inputViolation(
    key: string,
    command: CommandPartNames,
    extension: CommandPartNames,
): string | undefined {
    const internal = new Set(command.internalFields ?? []);
    const commandInput = new Set(command.inputFields ?? []);
    const commandConsents = new Set(command.consents ?? []);
    for (const field of extension.inputFields ?? []) {
        if (internal.has(field)) {
            return `the input field "${field}" of "${key}" is an internal field of the command`;
        }
        if (commandInput.has(field)) {
            return `the input field "${field}" of "${key}" exists already`;
        }
        if (commandConsents.has(field)) {
            return `the input field "${field}" of "${key}" is a consent of the command`;
        }
    }
    const consent = [...(extension.consents ?? [])].find(
        name => commandInput.has(name) || internal.has(name),
    );
    return consent === undefined
        ? undefined
        : `the consent "${consent}" of "${key}" is an input field of the command`;
}

/** A name of an extension that the command has already: an output field, consent, error or short flag. */
function takenViolation(
    key: string,
    command: CommandPartNames,
    extension: CommandPartNames,
): string | undefined {
    const taken = (mine: Iterable<string> | undefined, theirs: Iterable<string> | undefined) => {
        const names = new Set(theirs ?? []);
        return [...(mine ?? [])].find(name => names.has(name));
    };
    const output = taken(extension.outputFields, command.outputFields);
    if (output !== undefined) {
        return `the output field "${output}" of "${key}" exists already`;
    }
    const consent = taken(extension.consents, command.consents);
    if (consent !== undefined) {
        return `the consent "${consent}" of "${key}" exists already`;
    }
    const error = taken(extension.errorCodes, command.errorCodes);
    if (error !== undefined) {
        return `the error "${error}" of "${key}" exists already`;
    }
    const short = taken(extension.shortFlags, command.shortFlags);
    if (short !== undefined) {
        return `the short flag ${short} of "${key}" is taken already`;
    }
    return undefined;
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
        throw new TypeError('The module exports "extensions" that is not a list');
    }
    return extensions as CommandExtensionDefinition[];
}

/**
 * The loaded schemas of a command and its extensions, with the field names each declares, as
 * {@link commandExtensionParts} works them out.
 */
export interface CommandExtensionParts {
    command: Awaited<ReturnType<CommandDefinition['schemas']>>;
    extensions: Array<Awaited<ReturnType<CommandExtensionDefinition['schemas']>>>;
    /** The command's input fields, its internal ones included. */
    commandInputFields: Set<string>;
    commandOutputFields: Set<string>;
    /** The input fields of each extension, in order. */
    inputFields: Array<Set<string>>;
    /** The output fields of each extension, in order. */
    outputFields: Array<Set<string>>;
}

/**
 * The parts of a command and its extensions, from their loaded schemas. A host that loads the
 * schemas itself, to report an extension that fails to load, passes the parts to
 * {@link applyCommandExtensions}, so the schemas load once.
 */
export function commandExtensionParts(
    command: CommandExtensionParts['command'],
    extensions: CommandExtensionParts['extensions'],
): CommandExtensionParts {
    const inputFieldsOf = (schema: StandardSchema) =>
        new Set(
            Object.keys(propertiesOf(schema['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET }))),
        );
    const outputFieldsOf = (schema: StandardSchema | undefined) =>
        new Set(
            schema
                ? Object.keys(
                      propertiesOf(schema['~standard'].jsonSchema.output({ target: JSON_SCHEMA_TARGET })),
                  )
                : [],
        );
    return {
        command,
        extensions,
        commandInputFields: inputFieldsOf(command.input),
        commandOutputFields: outputFieldsOf(command.output),
        inputFields: extensions.map(schemas => inputFieldsOf(schemas.input)),
        outputFields: extensions.map(schemas => outputFieldsOf(schemas.output)),
    };
}

/** The names of a command or an extension that are known before its schemas load. */
function declaredNames(
    part: Pick<CommandDefinition, 'consents' | 'errors' | 'cli'>,
    kind: 'command' | 'extension',
): CommandPartNames {
    const fields = Object.entries(part.cli?.fields ?? {});
    return {
        [kind === 'command' ? 'internalFields' : 'markedInternal']: internalFieldsOf(part.cli),
        cliKeys: [...Object.keys(part.cli?.flags ?? {}), ...fields.map(([field]) => field)],
        shortFlags: Object.values(part.cli?.flags ?? {})
            .map(flag => flag.short)
            .filter((short): short is string => short !== undefined),
        consents: Object.keys(part.consents ?? {}),
        errorCodes: (part.errors ?? []).map(error => error.code),
    };
}

/**
 * The first rule that each extension of a command breaks, in the order given, outermost first.
 * Each is checked against the command with the extensions inside it applied, so of two that clash
 * the outer one, whose package was enabled later, breaks the rule. Without `parts`, only the
 * rules that need no schemas are checked.
 */
export function commandExtensionViolations(
    command: CommandDefinition,
    extensions: CommandExtensionDefinition[],
    parts?: CommandExtensionParts,
): Array<string | undefined> {
    const key = command.path.join(' ');
    const commandNames = declaredNames(command, 'command');
    const applied: Required<CommandPartNames> = {
        inputFields: parts ? [...parts.commandInputFields] : [],
        outputFields: parts ? [...parts.commandOutputFields] : [],
        internalFields: [...(commandNames.internalFields ?? [])],
        markedInternal: [],
        cliKeys: [...(commandNames.cliKeys ?? [])],
        shortFlags: [...(commandNames.shortFlags ?? [])],
        consents: [...(commandNames.consents ?? [])],
        errorCodes: [...(commandNames.errorCodes ?? [])],
    };
    const violations: Array<string | undefined> = new Array(extensions.length).fill(undefined);
    for (let index = extensions.length - 1; index >= 0; index--) {
        const extension = extensions[index];
        if (extension.path.join(' ') !== key) {
            violations[index] = `it extends "${extension.path.join(' ')}" instead`;
            continue;
        }
        const names: CommandPartNames = {
            ...declaredNames(extension, 'extension'),
            ...(parts
                ? { inputFields: parts.inputFields[index], outputFields: parts.outputFields[index] }
                : {}),
        };
        violations[index] = commandExtensionViolation(key, applied, names);
        for (const name of Object.keys(applied) as Array<keyof CommandPartNames>) {
            if (name !== 'internalFields' && name !== 'markedInternal') {
                (applied[name] as string[]).push(...(names[name] ?? []));
            }
        }
    }
    return violations;
}

/**
 * Options of {@link applyCommandExtensions}.
 */
export interface ApplyCommandExtensionsOptions {
    /** The package of each extension, in the same order, for the errors that name it. */
    packages?: string[];
    /** The parts, when the host loaded the schemas already. See {@link commandExtensionParts}. */
    parts?: CommandExtensionParts;
    /**
     * The run module of each extension, in the same order, when the host imported them already, so
     * that one that fails to import is left out before the command runs.
     */
    runs?: Array<Awaited<ReturnType<CommandExtensionDefinition['run']>>>;
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
 * It throws, naming the extension, for one that breaks a rule of {@link commandExtensionViolation}:
 * at once for the rules that need no schemas, and when the schemas load for the rest.
 *
 * @since 4.0.0
 */
export function applyCommandExtensions(
    command: CommandDefinition,
    extensions: CommandExtensionDefinition[],
    options: ApplyCommandExtensionsOptions = {},
): CommandDefinition {
    if (extensions.length === 0) {
        return command;
    }
    const key = command.path.join(' ');
    const labelOf = (index: number) =>
        options.packages?.[index]
            ? `the extension of "${key}" from ${options.packages[index]}`
            : `extension ${index + 1} of "${key}"`;
    const refuse = (violations: Array<string | undefined>) => {
        const index = violations.findIndex(violation => violation !== undefined);
        if (index !== -1) {
            const label = labelOf(index);
            throw new Error(
                `${label[0].toUpperCase()}${label.slice(1)} cannot be applied: ${violations[index]}`,
            );
        }
    };
    refuse(commandExtensionViolations(command, extensions));

    const consents: Record<string, string> = { ...command.consents };
    const errors: CommandErrorDefinition[] = [...(command.errors ?? [])];
    for (const extension of extensions) {
        Object.assign(consents, extension.consents);
        errors.push(...(extension.errors ?? []));
    }
    let loading: Promise<CommandExtensionParts> | undefined;
    const parts = () =>
        (loading ??= (async () => {
            const loaded =
                options.parts ??
                commandExtensionParts(
                    ...(await Promise.all([
                        command.schemas(),
                        Promise.all(extensions.map(e => e.schemas())),
                    ])),
                );
            refuse(commandExtensionViolations(command, extensions, loaded));
            return loaded;
        })());
    const allExtensionFields = (loaded: CommandExtensionParts) =>
        new Set(loaded.inputFields.flatMap(fields => [...fields]));
    const omitExtensionFields = (input: Record<string, unknown>, loaded: CommandExtensionParts) => {
        const theirs = allExtensionFields(loaded);
        return Object.fromEntries(Object.entries(input).filter(([field]) => !theirs.has(field)));
    };
    // The command's input as the caller gave it, by the input value the combined schema returned
    // for it, so `next(changes)` validates raw values and the command's transforms run once.
    const givenInput = new WeakMap<object, Record<string, unknown>>();
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
            const combined = combineInputs(command.path, [
                ...loaded.extensions.map((schemas, index) => ({
                    label: labelOf(index),
                    schema: schemas.input,
                })),
                { label: `the command "${key}"`, schema: loaded.command.input },
            ]);
            return {
                ...loaded.command,
                input: recordingGivenInput(combined, (given, result) => {
                    if (result.value !== null && typeof result.value === 'object') {
                        givenInput.set(result.value, omitExtensionFields(given, loaded));
                    }
                }),
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
                ...(options.runs ?? extensions.map(extension => extension.run())),
            ]);
            return {
                run: async (input: Record<string, unknown>, ctx: CommandContext) => {
                    /**
                     * Runs extension `index`, or the command after the last. `commandInput` is the
                     * command's validated input, and `given` the values it was validated from.
                     */
                    const call = async (
                        index: number,
                        commandInput: Record<string, unknown>,
                        given: Record<string, unknown>,
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
                        const next: CommandExtensionNextFn = async (changes, nextOptions) => {
                            let nextGiven = given;
                            let nextInput = commandInput;
                            if (changes !== undefined) {
                                nextGiven = { ...given, ...omitExtensionFields(changes, loaded) };
                                nextInput = await validated(
                                    loaded.command.input,
                                    nextGiven,
                                    `The input that ${labelOf(index)} gave next()`,
                                );
                            }
                            return call(
                                index + 1,
                                nextInput,
                                nextGiven,
                                scopedContext(context, nextOptions?.signal),
                            );
                        };
                        const result = await extensionRuns[index].run(extensionInput, context, next);
                        await checkOutput(result, index, loaded, labelOf(index));
                        return result;
                    };
                    const validatedInput = omitExtensionFields(input, loaded);
                    // A caller that validated the input with another schema, or passes it as it
                    // is, has no given input on record, so its validated input stands in for it.
                    return call(0, validatedInput, givenInput.get(input) ?? validatedInput, ctx);
                },
            };
        },
    };
}

/** The schema, calling `record` with each value it validates and the result it gives for it. */
function recordingGivenInput(
    schema: StandardSchema,
    record: (given: Record<string, unknown>, result: { value: unknown }) => void,
): StandardSchema {
    const validate = schema['~standard'].validate;
    const recorded = (value: unknown, result: StandardSchemaResult): StandardSchemaResult => {
        if (!result.issues) {
            record((value ?? {}) as Record<string, unknown>, result);
        }
        return result;
    };
    return {
        '~standard': {
            ...schema['~standard'],
            validate: (value: unknown) => {
                const result = validate(value);
                return result instanceof Promise
                    ? result.then(settled => recorded(value, settled))
                    : recorded(value, result);
            },
        },
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
 * Checks the ok output an extension returned: its own output fields, with its output schema. The
 * command's fields are the command's to answer for, so an extension never surfaces a mismatch
 * inside the command. A `failed()`, `incomplete()` or `fail()` result passes as it is, so an
 * extension that passes one on never makes a run fail in a new way. The host reports an invalid
 * output as an internal error, naming the extension.
 */
async function checkOutput(
    result: CommandRunResult<unknown>,
    index: number,
    loaded: CommandExtensionParts,
    label: string,
): Promise<void> {
    if (isIncompleteResult(result) || isErrorResult(result) || isFailedResult(result)) {
        return;
    }
    const extensionOutput = loaded.extensions[index].output;
    if (!extensionOutput || result === null || typeof result !== 'object') {
        return;
    }
    const own = loaded.outputFields[index];
    await validated(
        extensionOutput,
        Object.fromEntries(
            Object.entries(result as Record<string, unknown>).filter(([field]) => own.has(field)),
        ),
        `The output fields of ${label}`,
    );
}

/**
 * The context for a call of `next`: the outer one, except that its `ctx.signal` also fires when
 * `signal` does, and so do the processes `ctx.spawn` starts and a renewal in
 * `ctx.refreshCredential`. It inherits the rest from the outer context, so `ctx.credential` and
 * `ctx.account` stay current when a renewal replaces them there.
 */
function scopedContext(ctx: CommandContext, signal: AbortSignal | undefined): CommandContext {
    if (!signal) {
        return ctx;
    }
    const scoped = AbortSignal.any([ctx.signal, signal]);
    const withScoped = (given: AbortSignal | undefined) =>
        given ? AbortSignal.any([scoped, given]) : scoped;
    const refreshCredential = ctx.refreshCredential?.bind(ctx);
    const scopedCtx = Object.create(ctx) as CommandContext;
    Object.assign(scopedCtx, {
        signal: scoped,
        spawn: (command: string, args: string[], options?: SpawnOptions) =>
            ctx.spawn(command, args, { ...options, signal: withScoped(options?.signal) }),
        ...(refreshCredential
            ? {
                  refreshCredential: (failedToken?: string, options?: { signal?: AbortSignal }) =>
                      refreshCredential(failedToken, { signal: withScoped(options?.signal) }),
              }
            : {}),
    });
    return scopedCtx;
}
