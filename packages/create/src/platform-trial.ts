import { confirm } from '@clack/prompts';
import spawn from 'cross-spawn';
import path from 'path';
import pc from 'picocolors';

import { log } from './logger';

export const PLATFORM_TRIAL_QUESTION = 'Start your free 30-day trial of Vendure Platform?';

export interface PlatformTrialDependencies {
    env: NodeJS.ProcessEnv;
    isTTY: boolean;
    confirm: (message: string) => Promise<boolean | symbol>;
    /** Runs `vendure add --platform` in the project and resolves to its exit code. */
    runPlatformFlow: (projectRoot: string) => Promise<number>;
}

const defaultDependencies: PlatformTrialDependencies = {
    env: process.env,
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true,
    confirm: message => confirm({ message, initialValue: true }),
    runPlatformFlow,
};

/**
 * Asks the trial question after the project is installed. Yes runs the `vendure add` Platform
 * flow of the project's own CLI. A CI run, `--ci`, or a run without a terminal gets no question
 * and runs nothing. The question and the flow make no network call before the user answers Yes.
 */
export async function offerPlatformTrial(
    projectRoot: string,
    isCi: boolean,
    dependencies: Partial<PlatformTrialDependencies> = {},
): Promise<void> {
    const deps = { ...defaultDependencies, ...dependencies };
    if (isCi || isTruthy(deps.env.CI) || isTruthy(deps.env.VENDURE_CLI_NON_INTERACTIVE) || !deps.isTTY) {
        return;
    }
    // Anything but Yes, including a cancel, runs nothing.
    if ((await deps.confirm(PLATFORM_TRIAL_QUESTION)) !== true) {
        return;
    }
    const code = await deps.runPlatformFlow(projectRoot);
    if (code !== 0) {
        log(pc.yellow('Vendure Platform setup did not finish. Your project is ready to use.'));
        log(`To try again, run ${pc.cyan('npx vendure add --platform')} in ${projectRoot}.`, {
            newline: 'after',
        });
    }
}

function isTruthy(value: string | undefined): boolean {
    return value != null && !['', '0', 'false'].includes(value.trim().toLowerCase());
}

/**
 * Runs the CLI that the project installed, so the flow matches the project's `@vendure/cli`
 * version. Ctrl+C reaches the child and this process together. This process ignores it while the
 * child runs, so a cancel ends only the flow.
 */
function runPlatformFlow(projectRoot: string): Promise<number> {
    let cliPath: string;
    try {
        const packageJsonPath = require.resolve('@vendure/cli/package.json', { paths: [projectRoot] });
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        cliPath = path.join(path.dirname(packageJsonPath), require(packageJsonPath).bin.vendure);
    } catch (e) {
        log(
            pc.yellow(
                `Could not find the @vendure/cli of the project: ${e instanceof Error ? e.message : String(e)}`,
            ),
        );
        return Promise.resolve(1);
    }
    const ignore = () => undefined;
    process.on('SIGINT', ignore);
    return new Promise<number>(resolve => {
        const child = spawn(process.execPath, [cliPath, 'add', '--platform'], {
            cwd: projectRoot,
            stdio: 'inherit',
        });
        child.once('error', () => resolve(1));
        child.once('close', code => resolve(code ?? 1));
    }).finally(() => process.removeListener('SIGINT', ignore));
}
