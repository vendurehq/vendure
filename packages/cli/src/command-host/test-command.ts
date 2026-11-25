import type {
    CommandCredential,
    CommandDefinition,
    CommandEvent,
    SpawnOptions,
    SpawnResult,
} from '@vendure/common/lib/command';

import { credentialNeed } from '../auth/credential.js';

import { executeCommand, HostEnvironment, HostResult, Prompter } from './host.js';

/**
 * @description
 * The options of {@link testCommand}.
 *
 * @since 4.0.0
 */
export interface TestCommandOptions {
    /** The working directory `ctx.cwd` reports. Defaults to `process.cwd()`. */
    cwd?: string;
    /** Run as `vendure mcp` would, which selects the MCP defaults such as `wait: false`. */
    mcp?: boolean;
    /**
     * Answers for a person at a terminal. Without it, no person is present: a missing input is an
     * `input` need, and `ctx.ask` is not set.
     */
    prompter?: Prompter;
    /** What the host finds as the project root. `undefined` means outside a project. */
    projectRoot?: string | undefined;
    /** Answers `ctx.spawn`. Defaults to a process that exits with 0 and prints nothing. */
    spawn?: (command: string, args: string[], options?: SpawnOptions) => Promise<SpawnResult>;
    signal?: AbortSignal;
    /**
     * The credential a `requires.auth` command receives as `ctx.credential`. Without it, such a
     * command stops with the `token` input need, as it does without a login.
     */
    credential?: CommandCredential;
    /** Writes a secret output to a file. Defaults to none, so a secret output stays in the result. */
    writeSecret?: HostEnvironment['writeSecret'];
}

/**
 * @description
 * What {@link testCommand} resolves to: the envelope and exit code the CLI would report, the
 * validated input, every event the command reported, and every process it started.
 *
 * @since 4.0.0
 */
export interface TestCommandResult extends HostResult {
    events: CommandEvent[];
    spawned: Array<{ command: string; args: string[]; options?: SpawnOptions }>;
}

/**
 * @description
 * Runs a command declared with `defineCommand` through the CLI's command host, as `vendure <path>
 * --json` would, for a test. It goes through the same stages: input validation and needs, the
 * credential check, `plan()` and its consents, `run()`, and secret outputs. It fails when `run()`
 * or `plan()` writes to stdout or stderr, because a command reports through `ctx` only.
 *
 * Pass a command of a group with its group applied, as the host loads it: take it from
 * `commandDeclarations(module)` of `@vendure/common/lib/command`.
 *
 * It needs no test framework. Import it from `@vendure/cli` in a plugin's tests only: declaring
 * commands never loads `@vendure/cli`.
 *
 * @example
 * ```ts
 * import { testCommand } from '@vendure/cli';
 * import { commandDeclarations } from '@vendure/common/lib/command';
 *
 * import * as declarations from '../src/commands.js';
 *
 * const [sync] = commandDeclarations(declarations);
 * const result = await testCommand(sync, { dryRun: true });
 * expect(result.envelope).toMatchObject({ status: 'ok', output: { synced: 0 } });
 * ```
 *
 * @since 4.0.0
 */
export function testCommand(
    definition: CommandDefinition,
    input: Record<string, unknown>,
    options: TestCommandOptions = {},
): Promise<TestCommandResult> {
    const { credential } = options;
    return runInTestHost(definition, input, options, {
        requireCredential: async () => (credential ? { credential } : { needs: [credentialNeed()] }),
    });
}

/**
 * {@link testCommand} with parts of the host environment replaced. The CLI's own specs use it to
 * drive the host in ways a plugin's tests do not need, such as a credential check that throws.
 */
export async function runInTestHost(
    definition: CommandDefinition,
    input: Record<string, unknown>,
    options: TestCommandOptions,
    overrides: Partial<HostEnvironment> = {},
): Promise<TestCommandResult> {
    const events: CommandEvent[] = [];
    const spawned: TestCommandResult['spawned'] = [];
    const printed: string[] = [];
    const env: HostEnvironment = {
        cwd: options.cwd ?? process.cwd(),
        signal: options.signal ?? new AbortController().signal,
        mcp: options.mcp ?? false,
        prompter: options.prompter,
        ...(options.writeSecret ? { writeSecret: options.writeSecret } : {}),
        emit: event => events.push(event),
        spawn: async (command, args, spawnOptions) => {
            spawned.push({ command, args, ...(spawnOptions ? { options: spawnOptions } : {}) });
            return (
                (await options.spawn?.(command, args, spawnOptions)) ?? {
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                }
            );
        },
        findProjectRoot: () => ('projectRoot' in options ? options.projectRoot : '/project'),
        ...overrides,
    };
    // The console is replaced for the run, without a test framework, so a command that prints is
    // caught whatever the plugin's tests run on.
    // The original methods are put back on the same streams, so they keep their `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const writeStdout = process.stdout.write;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const writeStderr = process.stderr.write;
    const capture = ((chunk: unknown) => {
        printed.push(String(chunk));
        return true;
    }) as typeof process.stdout.write;
    process.stdout.write = capture;
    process.stderr.write = capture;
    let result: HostResult;
    try {
        result = await executeCommand(definition, input, env);
    } finally {
        process.stdout.write = writeStdout;
        process.stderr.write = writeStderr;
    }
    if (printed.length > 0) {
        throw new Error(`The command wrote to the console: ${printed.join('')}`);
    }
    return { ...result, events, spawned };
}
