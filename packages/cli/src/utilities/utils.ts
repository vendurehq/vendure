import { log } from '@clack/prompts';

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

/**
 * Wraps an interactive prompt with a timeout to prevent hanging in automated environments.
 * After 60 seconds, it shows a helpful message for AI agents and exits.
 */
export async function withInteractiveTimeout<T>(
    promptFn: () => Promise<T>,
    timeoutMs: number = 60000,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            log.warning('\n⚠Interactive mode timeout after 60 seconds\n');
            log.info('This appears to be an automated environment (AI agent/editor).');
            log.info('Interactive prompts are not suitable for automated tools.\n');
            log.info('Please use the non-interactive mode with specific command flags.\n');
            log.info('Examples:');
            log.info('   vendure add -p MyPlugin');
            log.info('   vendure add -e MyEntity');
            log.info('   vendure add -s MyService');
            log.info('   vendure migrate -g my-migration');
            log.info('   vendure migrate -r\n');
            log.info('--- For complete usage information, run:');
            log.info('   vendure --help');
            log.info('   vendure add --help');
            log.info('   vendure migrate --help\n');

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
