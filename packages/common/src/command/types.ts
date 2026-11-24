/**
 * The command contract. A command is described by plain data, so nothing here depends on which
 * copy of a package or class is loaded. Packages that declare commands import from
 * `@vendure/common/lib/command` and never need to load the CLI to do so.
 */

/**
 * @description
 * How a tool or command behaves, which tells a caller how to expose it. `readonly` only reads,
 * `mutating` changes data, and `destructive` changes data in a way that is hard to undo.
 */
export type ToolBehavior = 'readonly' | 'mutating' | 'destructive';

/**
 * @description
 * As {@link ToolBehavior}, plus `service` for a command that keeps running, such as a dev server.
 * Service commands are never exposed as tools.
 */
export type CommandBehavior = ToolBehavior | 'service';

/**
 * @description
 * Extra words a search over commands or tools also matches.
 */
export type Keywords = readonly string[];

/**
 * @description
 * One validation failure reported by a {@link StandardSchema}.
 */
export interface StandardSchemaIssue {
    /** A human readable message describing why the value was rejected. */
    readonly message: string;
    /**
     * Where the rejected value sits inside the validated input. Absent when the issue applies to
     * the value as a whole.
     */
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/**
 * @description
 * The result of validating a value against a {@link StandardSchema}.
 */
export type StandardSchemaResult<Output = unknown> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: readonly StandardSchemaIssue[] };

/**
 * @description
 * A JSON Schema document, as a plain object.
 */
export type JsonSchema = Record<string, unknown>;

/**
 * @description
 * A schema object implementing the [Standard Schema](https://standardschema.dev/) interface plus
 * its JSON Schema conversion extension. Zod v4, ArkType and Valibot schemas implement this shape.
 * It is declared structurally so that this package does not depend on any schema library.
 */
export interface StandardSchema<Input = unknown, Output = Input> {
    readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (
            value: unknown,
        ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
        readonly types?: { readonly input: Input; readonly output: Output };
        readonly jsonSchema: {
            input(options: {
                readonly target: string;
                readonly libraryOptions?: Record<string, unknown>;
            }): JsonSchema;
            output(options: {
                readonly target: string;
                readonly libraryOptions?: Record<string, unknown>;
            }): JsonSchema;
        };
    };
}

/**
 * @description
 * One way to fix a problem. `description` says what to do. When the fix is a command, `path` and
 * `input` name it, so a host can offer it as a command line or an MCP tool call. Startup errors and
 * `vendure dev` carry fixes of this shape.
 *
 * @docsCategory errors
 * @docsPage VendureStartupError
 * @since 4.0.0
 */
export interface Fix {
    description: string;
    /** The command path, for example `['migrate', 'generate']`. Present only when the fix is a command. */
    path?: string[];
    /** The input to pass to the command at `path`. Present only when the fix is a command. */
    input?: Record<string, unknown>;
}

/**
 * @description
 * A {@link Fix} that is a command path with its input. The host shows it as a command line on the
 * CLI, and as a tool name with arguments over MCP. Error text never contains CLI syntax, so a fix is
 * always structured.
 */
export interface CommandFix extends Fix {
    /** The command path, for example `['auth', 'login']`. */
    path: string[];
    /** The input to pass to that command. */
    input: Record<string, unknown>;
}

/**
 * @description
 * A required input that the caller did not supply.
 */
export interface InputNeed {
    kind: 'input';
    field: string;
    description: string;
    /** The value must not be sent through the model. It comes from stdin or the environment. */
    secret?: boolean;
    /** The valid values, when the field declares them. */
    choices?: string[];
    fix?: CommandFix;
}

/**
 * @description
 * A named consent. The caller passes `digest` as the value of the input field whose name is the
 * value of `consent`, for example `{ revertMigration: '<digest>' }`, then runs the same command
 * again. The host computes the preview again and asks again if the
 * digest no longer matches, so a consent never applies to something the caller did not see.
 */
export interface ConsentNeed {
    kind: 'consent';
    consent: string;
    description: string;
    digest: string;
    /** What the consent answers, so the caller can show it to a person. */
    preview?: unknown;
    fix?: CommandFix;
}

/**
 * @description
 * A step that only a person may take.
 */
export interface PersonNeed {
    kind: 'person';
    action: string;
    summary: string;
    url: string;
    fix?: CommandFix;
}

/**
 * @description
 * Something the caller must supply or do before the command can finish.
 */
export type CommandNeed = InputNeed | ConsentNeed | PersonNeed;

/**
 * @description
 * The version of the envelope. It versions the envelope only. The shape of a command's `output`
 * is the output schema in the manifest.
 */
export const COMMAND_ENVELOPE_SCHEMA_VERSION = 1;

/**
 * @description
 * How a run ended. `ok` and `failed` carry the command's output, `incomplete` carries needs, and
 * `error` carries an error.
 */
export type CommandStatus = 'ok' | 'failed' | 'incomplete' | 'error';

/**
 * @description
 * The error part of an envelope.
 */
export interface CommandErrorBody {
    code: string;
    /** The process exit code that goes with the error. */
    exit: number;
    message: string;
    fixes?: CommandFix[];
}

/**
 * @description
 * How much a notice matters. A `warning` is something the caller should act on or tell a person.
 */
export type CommandNoticeLevel = 'info' | 'warning';

/**
 * @description
 * A note from a command that the caller should see, such as the ID of a safety backup. Notices
 * are collected into the envelope, because most MCP clients do not show log notifications to
 * the model.
 */
export interface CommandNotice {
    level: CommandNoticeLevel;
    message: string;
}

/**
 * @description
 * The one document a run writes to stdout under `--json`.
 */
export interface CommandEnvelope<Output = unknown> {
    schemaVersion: typeof COMMAND_ENVELOPE_SCHEMA_VERSION;
    status: CommandStatus;
    output?: Output;
    needs?: CommandNeed[];
    error?: CommandErrorBody;
    notices: CommandNotice[];
}

/**
 * Exit codes of the CLI. `incomplete` has its own code so a caller can tell it from a failure.
 */
export const COMMAND_EXIT_CODES = {
    ok: 0,
    failed: 1,
    error: 1,
    incomplete: 3,
} as const;

/**
 * @description
 * A coded error, made with `defineError`.
 */
export interface CommandErrorDefinition<Details = any> {
    /** Must match {@link ERROR_CODE_PATTERN}, for example `devserver.not-running`. */
    code: string;
    exit: number;
    message: (details: Details) => string;
    fix?: (details: Details) => CommandFix[];
}

/** What a command's `run` returns when it needs something from the caller. */
export interface IncompleteResult {
    vendureResult: 'incomplete';
    needs: CommandNeed[];
    /** The output of the stages that finished before the command stopped. */
    output?: unknown;
}

/** What a command's `run` returns when it finished and its checks did not pass. */
export interface FailedResult<Output = unknown> {
    vendureResult: 'failed';
    output: Output;
}

/** What a command's `run` returns for a coded error. */
export interface ErrorResult {
    vendureResult: 'error';
    code: string;
    details: unknown;
}

/**
 * @description
 * An event a command reports while it runs. Under `--json` each one is a line of NDJSON on
 * stderr, tagged `"vendure": "event"`.
 */
export interface CommandEvent {
    vendure: 'event';
    type: string;
    [key: string]: unknown;
}

/** The result of a process started through `ctx.spawn`. */
export interface SpawnResult {
    exitCode: number | null;
    stdout: string;
    stderr: string;
}

export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
}

/**
 * @description
 * One choice of {@link CommandAsk.select}.
 */
export interface CommandChoice {
    value: string;
    label: string;
}

/**
 * @description
 * Asks a person at the terminal, for a question that only comes up while a command runs, such as
 * which of the organizations a login returned to use. A field the caller can pass up front is an
 * input instead, so that it works without a person too.
 */
export interface CommandAsk {
    /** Resolves to `undefined` when the person cancels. */
    confirm(message: string): Promise<boolean | undefined>;
    /** Resolves to the chosen `value`, or `undefined` when the person cancels. */
    select(message: string, choices: CommandChoice[]): Promise<string | undefined>;
}

/**
 * @description
 * What the host gives to `run` and `plan`. A command never prints, prompts or starts a process
 * by other means.
 */
export interface CommandContext {
    /** The working directory the command runs in. */
    cwd: string;
    /** Fires when the caller cancels the run. */
    signal: AbortSignal;
    /** True when the host is serving an MCP tool call. */
    mcp: boolean;
    /**
     * Asks a person. Present only when the host may prompt: stdin and stdout are TTYs, the run is
     * not under `--json` or `vendure mcp`, and neither `CI` nor `VENDURE_CLI_NON_INTERACTIVE` is
     * set. Without it, nobody may be there to answer, so a command never waits for a person: it
     * keeps a default or returns a need.
     */
    ask?: CommandAsk;
    /** Reports a note the caller should see. It also goes into the envelope's `notices`. */
    notice(level: CommandNoticeLevel, message: string): void;
    /** Reports progress. */
    progress(message: string, current?: number, total?: number): void;
    /** Reports an event of any other type. */
    event(type: string, data?: Record<string, unknown>): void;
    /** Starts a process. Under `--json` its stdout goes to stderr. */
    spawn(command: string, args: string[], options?: SpawnOptions): Promise<SpawnResult>;
}

/** What `plan` returns. */
export interface CommandPlan {
    /** What the command will do, naming the resolved target. It must be JSON serializable. */
    preview: unknown;
    /** The consents the caller must give for this preview. They must be declared on the command. */
    requiredConsents: string[];
}

/** The schemas module of a command. */
export interface CommandSchemas {
    input: StandardSchema;
    output?: StandardSchema;
    events?: StandardSchema;
}

export type CommandRunResult<Output> = Output | IncompleteResult | FailedResult<Output> | ErrorResult;

export type CommandRunFn<Input = any, Output = unknown> = (
    input: Input,
    ctx: CommandContext,
) => Promise<CommandRunResult<Output>>;

/** `plan` returns the preview, or `fail(...)` when it cannot work out what the command would do. */
export type CommandPlanFn<Input = any> = (
    input: Input,
    ctx: CommandContext,
) => Promise<CommandPlan | ErrorResult>;

export type CommandRenderFn<Output = any> = (output: Output) => string | void;

/** Command metadata used by the CLI only. MCP clients never see it. */
export interface CommandCliMetadata {
    flags?: Record<string, { short?: string; description?: string }>;
    /** Input fields taken as positional arguments, in order. */
    positional?: string[];
    fields?: Record<
        string,
        {
            /**
             * Ask a person for this optional field when it is missing. A required field is always
             * asked for when a person is present. Without a person, the field keeps its default.
             */
            prompt?: boolean;
            /** The value must not be sent through the model. */
            secret?: boolean;
            /** The valid values, computed from the project. */
            choices?: (ctx: CommandContext, input: Record<string, unknown>) => Promise<string[]>;
        }
    >;
}

/**
 * @description
 * A command declared as plain data. Declaring it loads no implementation and no schema library.
 */
export interface CommandDefinition {
    /** The command path, for example `['add', 'codegen']`. */
    path: string[];
    description: string;
    keywords?: Keywords;
    behavior: CommandBehavior;
    requires?: {
        /** The host refuses to run the command outside a Vendure project. */
        project?: boolean;
        /**
         * The command needs a Vendure Cloud credential. Before anything else runs, the host looks
         * for one: the stored login, then `VENDURE_CLOUD_TOKEN`, then a device login when a person
         * is at the terminal. Without one, the run is `incomplete` with an `input` need for the
         * secret `token` field, whose fix is `vendure auth login --json`. `run()` then reads the
         * credential with `requireCredential` from `@vendure/cli`.
         *
         * @since 4.0.0
         */
        auth?: 'cloud';
    };
    /** Named consents, each with a description. */
    consents?: Record<string, string>;
    schemas: () => Promise<CommandSchemas>;
    cli?: CommandCliMetadata;
    errors?: CommandErrorDefinition[];
    examples?: string[];
    expose?: { mcp?: boolean };
    run: () => Promise<{ run: CommandRunFn }>;
    plan?: () => Promise<{ plan: CommandPlanFn }>;
    render?: () => Promise<{ render: CommandRenderFn }>;
}
