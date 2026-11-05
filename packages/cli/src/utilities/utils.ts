import { log } from '@clack/prompts';

import { CliCommandExit, exitCliCommand } from '../shared/cli-command-exit';

interface TtyLike {
    isTTY?: boolean;
}

interface NonInteractiveEnvironmentOptions {
    stdin?: TtyLike;
    stdout?: TtyLike;
    env?: NodeJS.ProcessEnv;
}

interface InteractiveTimeoutOptions {
    timeoutMs?: number;
    examples?: readonly string[];
    helpCommands?: readonly string[];
    /** Decides whether the prompt times out. Defaults to the process's stdin, stdout and env. */
    environment?: NonInteractiveEnvironmentOptions;
}

/**
 * Since the AST manipulation is blocking, prompts will not get a
 * chance to be displayed unless we give a small async pause.
 */
export async function pauseForPromptDisplay() {
    await new Promise(resolve => setTimeout(resolve, 100));
}

export function isRunningInTsNode(): boolean {
    // @ts-ignore
    return process[Symbol.for('ts-node.register.instance')] != null;
}

export function isTruthyEnvVar(value: string | undefined): boolean {
    if (value == null) {
        return false;
    }
    return !['', '0', 'false'].includes(value.trim().toLowerCase());
}

export function isNonInteractiveEnvironment(options: NonInteractiveEnvironmentOptions = {}): boolean {
    const stdin = options.stdin ?? process.stdin;
    const stdout = options.stdout ?? process.stdout;
    const env = options.env ?? process.env;

    return (
        isTruthyEnvVar(env.CI) ||
        isTruthyEnvVar(env.VENDURE_CLI_NON_INTERACTIVE) ||
        stdin.isTTY !== true ||
        stdout.isTTY !== true
    );
}

export function abortIfNonInteractive(commandName: string, examples: string[]): boolean {
    if (!isNonInteractiveEnvironment()) {
        return false;
    }

    log.error(`Cannot run "${commandName}" interactively because non-interactive mode is active.`);
    log.info(
        'Provide explicit command flags, run from an interactive terminal, or unset VENDURE_CLI_NON_INTERACTIVE.',
    );
    if (examples.length) {
        log.info(`Examples:\n${examples.map(example => `   ${example}`).join('\n')}`);
    }
    exitCliCommand(1);
}

/**
 * Runs an interactive prompt. In a terminal, the prompt waits for the person
 * to answer, however long that takes. In a non-interactive environment (see
 * {@link isNonInteractiveEnvironment}), such as a coding agent or a pipe,
 * nobody may be there to answer, so the prompt gives up after the timeout,
 * names the flags that answer it, and exits.
 */
export async function withInteractiveTimeout<T>(
    promptFn: () => Promise<T>,
    options: number | InteractiveTimeoutOptions = 60000,
): Promise<T> {
    const timeoutOptions: InteractiveTimeoutOptions =
        typeof options === 'number' ? { timeoutMs: options } : options;
    if (!isNonInteractiveEnvironment(timeoutOptions.environment)) {
        return promptFn();
    }
    const timeoutMs = timeoutOptions.timeoutMs ?? 60000;
    const timeoutSeconds = Math.round(timeoutMs / 1000);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            log.warning(`No answer after ${timeoutSeconds} seconds, so the command stopped.`);
            log.info(
                'This run is non-interactive: stdin or stdout is not a terminal, or CI or ' +
                    'VENDURE_CLI_NON_INTERACTIVE is set. Pass the answers as command flags instead.',
            );
            if (timeoutOptions.examples?.length) {
                log.info(`Examples:\n${timeoutOptions.examples.map(example => `   ${example}`).join('\n')}`);
            }
            const helpCommands = timeoutOptions.helpCommands ?? ['vendure --help'];
            log.info(`For all options, run:\n${helpCommands.map(command => `   ${command}`).join('\n')}`);

            reject(new CliCommandExit(1));
        }, timeoutMs);

        promptFn()
            .then(result => {
                clearTimeout(timeout);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timeout);
                reject(error);
            });
    });
}
