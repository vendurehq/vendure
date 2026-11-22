import {
    COMMAND_ENVELOPE_SCHEMA_VERSION,
    COMMAND_EXIT_CODES,
    CommandContext,
    CommandDefinition,
    CommandEnvelope,
    CommandErrorBody,
    CommandErrorDefinition,
    CommandEvent,
    CommandNeed,
    CommandNotice,
    ConsentNeed,
    ErrorResult,
    InputNeed,
    isErrorResult,
    isFailedResult,
    isIncompleteResult,
    SpawnOptions,
    SpawnResult,
    StandardSchema,
} from '@vendure/common/lib/command';

import { consentDigest } from './digest.js';
import { hostErrors } from './host-errors.js';
import { kebab } from './naming.js';

/** Asks a person. Only given to the host when a person is present. */
export interface Prompter {
    /**
     * Asks for an input field. `validate` returns the problem with an answer, or `undefined` when
     * the answer is valid, so a person can correct a bad answer before the command runs. For an
     * `optional` field, an empty answer keeps its default, so a choice of values offers "none".
     */
    askInput(
        need: InputNeed,
        validate: (answer: string) => string | undefined,
        optional: boolean,
    ): Promise<string | undefined>;
    /** Shows the preview and asks whether to go ahead. */
    askConsent(need: ConsentNeed): Promise<boolean>;
}

export interface HostEnvironment {
    cwd: string;
    signal: AbortSignal;
    /** True when the host runs a tool call for `vendure mcp`. */
    mcp: boolean;
    /** Set only when stdin and stdout are TTYs, CI is not set, and `--json` is not used. */
    prompter?: Prompter;
    emit(event: CommandEvent): void;
    spawn(command: string, args: string[], options?: SpawnOptions): Promise<SpawnResult>;
    findProjectRoot(): string | undefined;
}

export interface HostResult {
    envelope: CommandEnvelope;
    exitCode: number;
}

function envelope(
    status: CommandEnvelope['status'],
    notices: CommandNotice[],
    rest: Partial<CommandEnvelope> = {},
): CommandEnvelope {
    return { schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION, status, ...rest, notices };
}

function errorBody(error: CommandErrorDefinition, details: unknown): CommandErrorBody {
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
    const json = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });
    return ((json.properties as Record<string, Record<string, any>> | undefined) ?? {})[field] ?? {};
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
    return {
        cwd: env.cwd,
        signal: env.signal,
        mcp: env.mcp,
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
        const choices = meta?.choices ? await meta.choices(ctx, input) : undefined;
        needs.push({
            kind: 'input',
            field,
            description: (property.description as string | undefined) ?? field,
            ...(meta?.secret ? { secret: true } : {}),
            ...(choices ? { choices } : {}),
        });
    }
    return needs;
}

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
 * It never prints. A person is only asked when the environment hands over a prompter.
 */
export async function executeCommand(
    def: CommandDefinition,
    rawInput: Record<string, unknown>,
    env: HostEnvironment,
): Promise<HostResult> {
    const notices: CommandNotice[] = [];
    try {
        const commandName = def.path.join(' ');
        if (def.requires?.project && !env.findProjectRoot()) {
            return errorResult(hostErrors.projectRequired, { command: commandName }, notices);
        }
        const ctx = createContext(env, notices);
        const schemas = await def.schemas();
        const consentNames = Object.keys(def.consents ?? {});
        const input: Record<string, unknown> = { ...rawInput };
        const consentValues = Object.fromEntries(consentNames.map(name => [name, input[name]]));
        for (const name of consentNames) {
            delete input[name];
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
            const needs = await inputNeeds(def, schemas.input, missing, ctx, input);
            if (!env.prompter) {
                return incompleteResult(needs, notices);
            }
            for (const need of needs) {
                asked.add(need.field);
                const optional = !validation.issues;
                const answer = await env.prompter.askInput(
                    need,
                    value => answerProblem(schemas.input, input, need.field, value, optional),
                    optional,
                );
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
        const { run } = await def.run();
        const result = await run(parsed, ctx);
        if (isIncompleteResult(result)) {
            return incompleteResult(result.needs, notices, result.output);
        }
        if (isErrorResult(result)) {
            return declaredError(def, result, notices);
        }
        if (isFailedResult(result)) {
            return {
                envelope: envelope('failed', notices, { output: result.output }),
                exitCode: COMMAND_EXIT_CODES.failed,
            };
        }
        return { envelope: envelope('ok', notices, { output: result }), exitCode: COMMAND_EXIT_CODES.ok };
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

/** A fix as a command line, for a person at a terminal. */
export function formatFix(fix: { path: string[]; input: Record<string, unknown> }): string {
    // A boolean flag is a switch: `--<flag>` for true, `--no-<flag>` for false. Leaving it out
    // lets the command choose, which is not the same as false.
    const flags = Object.entries(fix.input)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => {
            if (typeof value === 'boolean') {
                return value ? `--${kebab(key)}` : `--no-${kebab(key)}`;
            }
            return `--${kebab(key)} ${JSON.stringify(value)}`;
        });
    return ['vendure', ...fix.path, ...flags].join(' ');
}
