import type {
    CommandCredential,
    CommandDefinition,
    CommandEvent,
    SpawnOptions,
    SpawnResult,
} from '@vendure/common/lib/command';

import { credentialNeed } from '../auth/credential.js';

import { executeCommand, HostEnvironment, HostResult, Prompter } from './host.js';

/** The `console` methods a command could print with. */
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** Whether a run is in progress, since the console is replaced for its duration. */
let activeRun = false;

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
    /**
     * What the host finds as the project root. Defaults to `/project`, so a command with
     * `requires: { project: true }` runs. Pass `undefined` to test it outside a project.
     */
    projectRoot?: string | undefined;
    /** Answers `ctx.spawn`. Defaults to a process that exits with 0 and prints nothing. */
    spawn?: (command: string, args: string[], options?: SpawnOptions) => Promise<SpawnResult>;
    signal?: AbortSignal;
    /**
     * The credential a `requires.auth` command receives as `ctx.credential`. Without it, such a
     * command stops with the `token` input need, as it does without a login.
     */
    credential?: CommandCredential;
    /**
     * Writes a secret output to a file, and returns its path. Without it, a run that no person sees
     * refuses a command with secret outputs, as a host that cannot keep them safe does.
     */
    writeSecret?: (command: string[], field: string, value: string) => string;
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
 * commands never loads `@vendure/cli`. It replaces the process's console for the run, so runs must
 * not overlap: one that starts while another is running is refused.
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
    // The console is replaced for the run, without a test framework: the stream writes, and the
    // `console` methods, which test runners replace with their own that bypass the streams.
    if (activeRun) {
        throw new Error('testCommand runs must not overlap: another run is still in progress');
    }
    activeRun = true;
    const capture = (...chunks: unknown[]) => {
        printed.push(chunks.map(String).join(' '));
        return true;
    };
    // The original methods are put back on the same objects, so they keep their `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const writeStdout = process.stdout.write;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const writeStderr = process.stderr.write;
    /* eslint-disable no-console -- the console is what this replaces, to catch a command that prints */
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const consoleMethods = CONSOLE_METHODS.map(name => [name, console[name]] as const);
    process.stdout.write = capture;
    process.stderr.write = capture;
    for (const name of CONSOLE_METHODS) {
        console[name] = capture;
    }
    let result: HostResult;
    try {
        result = await executeCommand(definition, input, env);
    } finally {
        process.stdout.write = writeStdout;
        process.stderr.write = writeStderr;
        for (const [name, method] of consoleMethods) {
            console[name] = method;
        }
        /* eslint-enable no-console */
        activeRun = false;
    }
    if (printed.length > 0) {
        throw new Error(`The command wrote to the console: ${printed.join('')}`);
    }
    return { ...result, events, spawned };
}
