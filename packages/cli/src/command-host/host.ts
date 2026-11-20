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

/** Asks a person. Only given to the host when a person is present. */
export interface Prompter {
    askInput(need: InputNeed): Promise<string | undefined>;
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

function errorResult(error: CommandErrorDefinition, details: unknown, notices: CommandNotice[]): HostResult {
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

        // Stage 1: inputs.
        let parsed: Record<string, unknown>;
        for (;;) {
            const validation = await schemas.input['~standard'].validate(input);
            if (!validation.issues) {
                parsed = validation.value as Record<string, unknown>;
                break;
            }
            const { missing, invalid } = classifyIssues(validation.issues, input);
            if (invalid.length > 0) {
                return errorResult(hostErrors.inputInvalid, { messages: invalid }, notices);
            }
            const needs: InputNeed[] = [];
            for (const field of missing) {
                const meta = def.cli?.fields?.[field];
                const property = propertySchema(schemas.input, field);
                const choices = meta?.choices ? await meta.choices(ctx, input) : undefined;
                needs.push({
                    kind: 'input',
                    field,
                    description: (property.description as string | undefined) ?? field,
                    ...(meta?.secret ? { secret: true } : {}),
                    ...(choices ? { choices } : {}),
                });
            }
            if (!env.prompter) {
                return incompleteResult(needs, notices);
            }
            for (const need of needs) {
                const answer = await env.prompter.askInput(need);
                if (answer === undefined) {
                    return errorResult(hostErrors.cancelled, {}, notices);
                }
                input[need.field] = coercePrompted(answer, propertySchema(schemas.input, need.field));
            }
        }

        // Stage 2: the preview and its consents.
        if (def.plan) {
            const { plan } = await def.plan();
            const planned = await plan(parsed, ctx);
            const needs: ConsentNeed[] = [];
            for (const consent of planned.consents) {
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

        // Stage 3: run.
        const { run } = await def.run();
        const result = await run(parsed, ctx);
        if (env.signal.aborted) {
            return errorResult(hostErrors.cancelled, {}, notices);
        }
        if (isIncompleteResult(result)) {
            return incompleteResult(result.needs, notices, result.output);
        }
        if (isErrorResult(result)) {
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
    const flags = Object.entries(fix.input).map(([key, value]) => {
        const flag = `--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
        return value === true ? flag : `${flag} ${JSON.stringify(value)}`;
    });
    return ['vendure', ...fix.path, ...flags].join(' ');
}
