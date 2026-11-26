import {
    COMMAND_ENVELOPE_SCHEMA_VERSION,
    COMMAND_EXIT_CODES,
    CommandChoice,
    CommandContext,
    CommandCredential,
    CommandDefinition,
    CommandEnvelope,
    CommandErrorBody,
    CommandErrorDefinition,
    CommandEvent,
    CommandNeed,
    CommandNotice,
    CommandOutputEvent,
    CommandSelectOptions,
    CommandTextOptions,
    ConsentNeed,
    ErrorResult,
    InputNeed,
    isErrorResult,
    isFailedResult,
    isIncompleteResult,
    JSON_SCHEMA_TARGET,
    SpawnOptions,
    SpawnResult,
    StandardSchema,
} from '@vendure/common/lib/command';

import { consentDigest } from './digest.js';
import { hostErrors } from './host-errors.js';

/**
 * @description
 * How the host asks for one input field: the check of an answer, and what kind of field it is.
 *
 * @since 4.0.0
 */
export interface AskInputOptions {
    /**
     * The problem with an answer, or `undefined` when it is valid, so a person can correct a bad
     * answer before the command runs.
     */
    validate: (answer: string) => string | undefined;
    /** An empty answer keeps the field's default, so a choice of values offers "none". */
    optional: boolean;
    /** The field is a boolean, so the answer is "true" or "false". */
    boolean: boolean;
}

/**
 * @description
 * Asks a person. The host is given one only when a person is present at a terminal. A test passes
 * its own to `testCommand` to answer as a person would: each method resolves to the answer, or to
 * `undefined` for a cancel.
 *
 * @since 4.0.0
 */
export interface Prompter {
    /** Asks for an input field. Resolves to `undefined` when the person cancels. */
    askInput(need: InputNeed, options: AskInputOptions): Promise<string | undefined>;
    /** Shows the preview and asks whether to go ahead. */
    askConsent(need: ConsentNeed): Promise<boolean>;
    /** Asks a yes or no question for `ctx.ask`. Resolves to `undefined` when the person cancels. */
    confirm(message: string): Promise<boolean | undefined>;
    /**
     * Asks for one of `choices` for `ctx.ask`, or with `other` for a typed value. Resolves to
     * `undefined` when the person cancels.
     */
    select(
        message: string,
        choices: CommandChoice[],
        options?: CommandSelectOptions,
    ): Promise<string | undefined>;
    /** Asks for a line of text for `ctx.ask`. Resolves to `undefined` when the person cancels. */
    text(message: string, options?: CommandTextOptions): Promise<string | undefined>;
}

/**
 * @description
 * Starts a process for `ctx.spawn`.
 *
 * @since 4.0.0
 */
export type SpawnFn = (command: string, args: string[], options?: SpawnOptions) => Promise<SpawnResult>;

/**
 * @description
 * Writes a secret output value to a file that only the user can read, and returns its path.
 *
 * @since 4.0.0
 */
export type WriteSecretFn = (command: string[], field: string, value: string) => string;

export interface HostEnvironment {
    cwd: string;
    signal: AbortSignal;
    /** True when the host runs a tool call for `vendure mcp`. */
    mcp: boolean;
    /** Set only when stdin and stdout are TTYs, CI is not set, and `--json` is not used. */
    prompter?: Prompter;
    emit(event: CommandEvent): void;
    spawn: SpawnFn;
    findProjectRoot(): string | undefined;
    /**
     * Finds the credential a command with `requires.auth` needs, signing a person in only when
     * `ctx.ask` is set. Resolves to the credential, which `run()` receives as `ctx.credential`, or
     * to the needs that stop the run.
     */
    requireCredential?(
        kind: 'cloud',
        ctx: CommandContext,
    ): Promise<{ credential: CommandCredential } | { needs: CommandNeed[] }>;
    /**
     * Writes a secret output value to a file that only the user can read, and returns its
     * absolute path. Needed for a command with `secretOutputs` when no person sees the output.
     */
    writeSecret?: WriteSecretFn;
}

export interface HostResult {
    envelope: CommandEnvelope;
    exitCode: number;
    /** The validated input `run()` received, for `render()`. Present when `run()` ran. */
    input?: Record<string, unknown>;
}

function envelope(
    status: CommandEnvelope['status'],
    notices: CommandNotice[],
    rest: Partial<CommandEnvelope> = {},
): CommandEnvelope {
    return { schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION, status, ...rest, notices };
}

/** The error part of an envelope, for a coded error and its details. */
export function errorBody(error: CommandErrorDefinition, details: unknown): CommandErrorBody {
    const fixes = error.fix?.(details);
    return {
        code: error.code,
        exit: error.exit,
        message: error.message(details),
        ...(fixes && fixes.length ? { fixes } : {}),
    };
}

/** The result of a run that ended with a coded error. */
export function errorResult(
    error: CommandErrorDefinition,
    details: unknown,
    notices: CommandNotice[] = [],
): HostResult {
    const body = errorBody(error, details);
    return { envelope: envelope('error', notices, { error: body }), exitCode: body.exit };
}

function incompleteResult(needs: CommandNeed[], notices: CommandNotice[], output?: unknown): HostResult {
    return {
        envelope: envelope('incomplete', notices, { needs, ...(output === undefined ? {} : { output }) }),
        exitCode: COMMAND_EXIT_CODES.incomplete,
    };
}

/**
 * Splits validation issues into inputs the caller left out and every other problem. An issue at
 * the top level of a field the input does not have is a missing input.
 */
function classifyIssues(
    issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }>,
    input: Record<string, unknown>,
): { missing: string[]; invalid: string[] } {
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const issue of issues) {
        const first = issue.path?.[0];
        const field = typeof first === 'object' ? first.key : first;
        if (issue.path?.length === 1 && typeof field === 'string' && input[field] === undefined) {
            if (!missing.includes(field)) {
                missing.push(field);
            }
        } else {
            const where = issue.path?.length
                ? `${issue.path.map(p => String(typeof p === 'object' ? p.key : p)).join('.')}: `
                : '';
            invalid.push(`${where}${issue.message}`);
        }
    }
    return { missing, invalid };
}

function propertySchema(schema: StandardSchema, field: string): Record<string, any> {
    const json = schema['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET });
    return ((json.properties as Record<string, Record<string, any>> | undefined) ?? {})[field] ?? {};
}

function isRequired(schema: StandardSchema, field: string): boolean {
    const json = schema['~standard'].jsonSchema.input({ target: JSON_SCHEMA_TARGET });
    return Array.isArray(json.required) && (json.required as unknown[]).includes(field);
}

function coercePrompted(value: string, property: Record<string, any>): unknown {
    if (property.type === 'number' || property.type === 'integer') {
        return Number(value);
    }
    if (property.type === 'boolean') {
        return value === 'true';
    }
    if (property.type === 'array') {
        return value
            .split(',')
            .map(v => v.trim())
            .filter(Boolean);
    }
    return value;
}

/**
 * The problem the input schema finds with one answer to a prompt, or `undefined`. An empty answer
 * to an optional field keeps its default, so it is always valid. A schema that only validates
 * asynchronously is not checked here; the host validates the whole input after the prompts.
 */
function answerProblem(
    schema: StandardSchema,
    input: Record<string, unknown>,
    field: string,
    answer: string,
    optional: boolean,
): string | undefined {
    if (optional && answer === '') {
        return undefined;
    }
    const candidate = { ...input, [field]: coercePrompted(answer, propertySchema(schema, field)) };
    const result = schema['~standard'].validate(candidate);
    if (result instanceof Promise || !result.issues) {
        return undefined;
    }
    const issue = result.issues.find(({ path }) => {
        const first = path?.[0];
        return (typeof first === 'object' ? first.key : first) === field;
    });
    return issue?.message;
}

function createContext(env: HostEnvironment, notices: CommandNotice[]): CommandContext {
    const { prompter } = env;
    return {
        cwd: env.cwd,
        signal: env.signal,
        mcp: env.mcp,
        ...(prompter
            ? {
                  ask: {
                      confirm: message => prompter.confirm(message),
                      select: (message, choices, options) => prompter.select(message, choices, options),
                      text: (message, options) => prompter.text(message, options),
                  },
              }
            : {}),
        notice: (level, message) => {
            notices.push({ level, message });
            env.emit({ vendure: 'event', type: 'notice', level, message });
        },
        progress: (message, current, total) => {
            env.emit({
                vendure: 'event',
                type: 'progress',
                message,
                ...(current === undefined ? {} : { current }),
                ...(total === undefined ? {} : { total }),
            });
        },
        output: (text, stream = 'stdout') => {
            const event: CommandOutputEvent = { vendure: 'event', type: 'output', stream, text };
            env.emit(event);
        },
        event: (type, data = {}) => {
            env.emit({ ...data, vendure: 'event', type });
        },
        spawn: (command, args, options) => env.spawn(command, args, options),
    };
}

/** The needs for missing input fields, with the computed choices of fields that declare them. */
async function inputNeeds(
    def: CommandDefinition,
    inputSchema: StandardSchema,
    fields: string[],
    ctx: CommandContext,
    input: Record<string, unknown>,
): Promise<InputNeed[]> {
    const needs: InputNeed[] = [];
    for (const field of fields) {
        const meta = def.cli?.fields?.[field];
        const property = propertySchema(inputSchema, field);
        // No choices can mean that a field they depend on is missing, such as a plugin's services
        // before the plugin is known, so an empty list is left out rather than read as "none".
        const choices = meta?.choices ? await meta.choices(ctx, input) : undefined;
        needs.push({
            kind: 'input',
            field,
            description: (property.description as string | undefined) ?? field,
            ...(meta?.secret ? { secret: true } : {}),
            ...(choices?.length ? { choices } : {}),
        });
    }
    return needs;
}

/**
 * Moves the command's secret output fields out of the output when no person sees it: each value
 * goes to a file only the user can read, and the output holds `{ secretFile }` instead. A person
 * at the terminal sees the value once, through `render()`.
 */
function protectSecrets(
    def: CommandDefinition,
    output: unknown,
    env: HostEnvironment,
    notices: CommandNotice[],
): { output: unknown } | { error: HostResult } {
    const fields = def.secretOutputs ?? [];
    if (fields.length === 0 || personSeesOutput(env) || output === null || typeof output !== 'object') {
        return { output };
    }
    const copy: Record<string, unknown> = { ...(output as Record<string, unknown>) };
    const written: string[] = [];
    for (const field of fields) {
        const value = copy[field];
        if (value === undefined || value === null) {
            continue;
        }
        let secretFile: string;
        try {
            // executeCommand refuses before run() without a writer; this keeps the function safe alone.
            if (!env.writeSecret) {
                throw new Error('this host cannot write secret files');
            }
            secretFile = env.writeSecret(
                def.path,
                field,
                typeof value === 'string' ? value : JSON.stringify(value),
            );
        } catch (e) {
            // The files already written hold secrets too, so the error names them.
            const already = written.length
                ? ` The secrets already written are in ${written.join(', ')}.`
                : '';
            return {
                error: errorResult(
                    hostErrors.internal,
                    {
                        message: `Could not keep the secret "${field}" out of the output: ${
                            e instanceof Error ? e.message : String(e)
                        }.${already}`,
                    },
                    notices,
                ),
            };
        }
        written.push(secretFile);
        copy[field] = { secretFile };
        notices.push({
            level: 'info',
            message:
                `${field} is in ${secretFile}, which only you can read. It is not in this output. ` +
                'Delete the file once you have stored the value.',
        });
    }
    return { output: copy };
}

/** Whether a person sees the output, through `render()`: only at a terminal, never over MCP. */
function personSeesOutput(env: HostEnvironment): boolean {
    return env.prompter !== undefined && !env.mcp;
}

/**
 * How many times the host runs a command whose `run()` returns input needs, asking a person for
 * them between runs, before it returns the needs instead.
 */
const MAX_RUNS = 3;

/** A coded error from `plan()` or `run()`, which the command must have declared. */
function declaredError(def: CommandDefinition, result: ErrorResult, notices: CommandNotice[]): HostResult {
    const error = def.errors?.find(e => e.code === result.code);
    if (!error) {
        return errorResult(
            hostErrors.internal,
            { message: `The command returned the undeclared error "${result.code}"` },
            notices,
        );
    }
    return errorResult(error, result.details, notices);
}

/**
 * Runs a command to its envelope, in a fixed order that stops at the first stage with needs:
 * the inputs, then the consents that `plan()` asks for, then `run()`.
 *
 * It never prints. A person is only asked when the environment hands over a prompter. When
 * `run()` returns `incomplete` with only input needs, a person is asked for them and the command
 * runs again; `attempt` counts those runs.
 */
export async function executeCommand(
    def: CommandDefinition,
    rawInput: Record<string, unknown>,
    env: HostEnvironment,
    attempt = 1,
): Promise<HostResult> {
    const notices: CommandNotice[] = [];
    try {
        const commandName = def.path.join(' ');
        if (def.requires?.project && !env.findProjectRoot()) {
            return errorResult(hostErrors.projectRequired, { command: commandName }, notices);
        }
        const ctx = createContext(env, notices);
        if (def.requires?.auth) {
            if (!env.requireCredential) {
                return errorResult(
                    hostErrors.internal,
                    { message: `"${commandName}" needs a credential, which this host cannot provide` },
                    notices,
                );
            }
            let found: { credential: CommandCredential } | { needs: CommandNeed[] };
            try {
                found = await env.requireCredential(def.requires.auth, ctx);
            } catch (e) {
                // A renewal without a network, or a denied or expired sign-in, is an ordinary
                // outcome with a fix, not an internal error.
                if (env.signal.aborted) {
                    return errorResult(hostErrors.cancelled, {}, notices);
                }
                return errorResult(
                    hostErrors.credentialFailed,
                    { message: e instanceof Error ? e.message : String(e) },
                    notices,
                );
            }
            if ('needs' in found) {
                return incompleteResult(found.needs, notices);
            }
            ctx.credential = found.credential;
        }
        const schemas = await def.schemas();
        const consentNames = Object.keys(def.consents ?? {});
        const input: Record<string, unknown> = { ...rawInput };
        const consentValues = Object.fromEntries(consentNames.map(name => [name, input[name]]));
        for (const name of consentNames) {
            delete input[name];
        }
        // An internal field is set only by an extension, through `next()`, never by a caller.
        for (const [field, meta] of Object.entries(def.cli?.fields ?? {})) {
            if (meta.internal) {
                delete input[field];
            }
        }

        // Stage 1: inputs. A missing required field is a need. A person is also asked for the
        // optional fields that declare `prompt: true`; without a person they keep their default.
        let parsed: Record<string, unknown>;
        const asked = new Set<string>();
        for (;;) {
            const validation = await schemas.input['~standard'].validate(input);
            let missing: string[];
            if (validation.issues) {
                const classified = classifyIssues(validation.issues, input);
                if (classified.invalid.length > 0) {
                    return errorResult(hostErrors.inputInvalid, { messages: classified.invalid }, notices);
                }
                missing = classified.missing;
            } else {
                missing = env.prompter
                    ? Object.entries(def.cli?.fields ?? {})
                          .filter(([field, meta]) => meta.prompt && input[field] === undefined)
                          .map(([field]) => field)
                          .filter(field => !asked.has(field))
                    : [];
                if (missing.length === 0) {
                    parsed = validation.value as Record<string, unknown>;
                    break;
                }
            }
            if (!env.prompter) {
                return incompleteResult(await inputNeeds(def, schemas.input, missing, ctx, input), notices);
            }
            // One field at a time, so the choices of a field see the answers before it, such as
            // the services of the plugin the person just picked.
            for (const field of missing) {
                const [need] = await inputNeeds(def, schemas.input, [field], ctx, input);
                asked.add(need.field);
                const optional = !validation.issues;
                const answer = await env.prompter.askInput(need, {
                    validate: value => answerProblem(schemas.input, input, need.field, value, optional),
                    optional,
                    boolean: propertySchema(schemas.input, need.field).type === 'boolean',
                });
                if (answer === undefined) {
                    return errorResult(hostErrors.cancelled, {}, notices);
                }
                // An empty answer to an optional field keeps its default.
                if (answer !== '' || validation.issues) {
                    input[need.field] = coercePrompted(answer, propertySchema(schemas.input, need.field));
                }
            }
        }

        // Stage 2: the preview and its consents.
        if (def.plan) {
            const { plan } = await def.plan();
            const planned = await plan(parsed, ctx);
            if (isErrorResult(planned)) {
                return declaredError(def, planned, notices);
            }
            const needs: ConsentNeed[] = [];
            for (const consent of planned.requiredConsents) {
                if (!def.consents || !(consent in def.consents)) {
                    return errorResult(
                        hostErrors.internal,
                        { message: `plan() asked for the undeclared consent "${consent}"` },
                        notices,
                    );
                }
                const digest = consentDigest(consent, planned.preview);
                if (consentValues[consent] !== digest) {
                    needs.push({
                        kind: 'consent',
                        consent,
                        description: def.consents[consent],
                        digest,
                        preview: planned.preview,
                    });
                }
            }
            if (needs.length > 0) {
                if (!env.prompter) {
                    return incompleteResult(needs, notices);
                }
                for (const need of needs) {
                    if (!(await env.prompter.askConsent(need))) {
                        return errorResult(hostErrors.cancelled, {}, notices);
                    }
                }
            }
        }

        // Stage 3: run. Once `run()` has returned, its result is reported even when the caller
        // cancelled meanwhile: the work it reports has happened.
        if (env.signal.aborted) {
            return errorResult(hostErrors.cancelled, {}, notices);
        }
        // A command with secret outputs may create the secret, such as a minted key, so a host
        // that could not keep it out of the output refuses before anything is created.
        if (def.secretOutputs?.length && !personSeesOutput(env) && !env.writeSecret) {
            return errorResult(
                hostErrors.internal,
                { message: 'This host cannot keep the secret outputs of this command out of its output' },
                notices,
            );
        }
        const { run } = await def.run();
        const result = await run(parsed, ctx);
        if (isIncompleteResult(result)) {
            const inputNeedsOnly = result.needs.every((need): need is InputNeed => need.kind === 'input');
            // `run()` found that it needs more input, which only it could tell. A person is asked
            // for it, and the command runs again: running again after `incomplete` is safe.
            if (env.prompter && inputNeedsOnly && attempt < MAX_RUNS) {
                const answers: Record<string, unknown> = {};
                for (const need of result.needs as InputNeed[]) {
                    // A need for an optional field may be left empty, for example when `run()`
                    // needs one of two names and the person gives the other.
                    const optional = !isRequired(schemas.input, need.field);
                    const answer = await env.prompter.askInput(need, {
                        validate: value =>
                            answerProblem(
                                schemas.input,
                                { ...input, ...answers },
                                need.field,
                                value,
                                optional,
                            ),
                        optional,
                        boolean: propertySchema(schemas.input, need.field).type === 'boolean',
                    });
                    if (answer === undefined) {
                        return errorResult(hostErrors.cancelled, {}, notices);
                    }
                    if (answer !== '' || !optional) {
                        answers[need.field] = coercePrompted(
                            answer,
                            propertySchema(schemas.input, need.field),
                        );
                    }
                }
                const retried = await executeCommand(
                    def,
                    { ...rawInput, ...input, ...answers },
                    env,
                    attempt + 1,
                );
                retried.envelope.notices = [...notices, ...retried.envelope.notices];
                return retried;
            }
            if (result.output === undefined) {
                return incompleteResult(result.needs, notices);
            }
            const protectedPartial = protectSecrets(def, result.output, env, notices);
            if ('error' in protectedPartial) {
                return protectedPartial.error;
            }
            return incompleteResult(result.needs, notices, protectedPartial.output);
        }
        if (isErrorResult(result)) {
            return declaredError(def, result, notices);
        }
        const output = isFailedResult(result) ? result.output : result;
        const protectedOutput = protectSecrets(def, output, env, notices);
        if ('error' in protectedOutput) {
            return protectedOutput.error;
        }
        if (isFailedResult(result)) {
            return {
                envelope: envelope('failed', notices, { output: protectedOutput.output }),
                exitCode: COMMAND_EXIT_CODES.failed,
                input: parsed,
            };
        }
        return {
            envelope: envelope('ok', notices, { output: protectedOutput.output }),
            exitCode: COMMAND_EXIT_CODES.ok,
            input: parsed,
        };
    } catch (e) {
        if (env.signal.aborted) {
            return errorResult(hostErrors.cancelled, {}, notices);
        }
        return errorResult(
            hostErrors.internal,
            { message: e instanceof Error ? e.message : String(e) },
            notices,
        );
    }
}
