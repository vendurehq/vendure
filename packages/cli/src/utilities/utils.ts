import { log } from '@clack/prompts';

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
    process.exit(1);
    return true;
}

/**
 * Wraps an interactive prompt with a timeout to prevent hanging in automated environments.
 * After the timeout, it shows a helpful message for AI agents and exits.
 */
export async function withInteractiveTimeout<T>(
    promptFn: () => Promise<T>,
    options: number | InteractiveTimeoutOptions = 60000,
): Promise<T> {
    const timeoutOptions: InteractiveTimeoutOptions =
        typeof options === 'number' ? { timeoutMs: options } : options;
    const timeoutMs = timeoutOptions.timeoutMs ?? 60000;
    const timeoutSeconds = Math.round(timeoutMs / 1000);

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            log.warning(`\n⚠Interactive mode timeout after ${timeoutSeconds} seconds\n`);
            log.info('This appears to be an automated environment (AI agent/editor).');
            log.info('Interactive prompts are not suitable for automated tools.\n');
            log.info('Please use the non-interactive mode with specific command flags.\n');
            if (timeoutOptions.examples?.length) {
                log.info('Examples:');
                log.info(`${timeoutOptions.examples.map(example => `   ${example}`).join('\n')}\n`);
            }
            log.info('--- For complete usage information, run:');
            const helpCommands = timeoutOptions.helpCommands ?? ['vendure --help'];
            log.info(`${helpCommands.map(command => `   ${command}`).join('\n')}\n`);

            process.exit(1);
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
