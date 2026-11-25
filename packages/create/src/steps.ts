import spawn from 'cross-spawn';

import { CreateError } from './errors.js';
import { CliLogLevel, GitResult, PackageManager } from './types.js';

export interface RunResult {
    code: number | null;
    /** The tail of stdout and stderr together. */
    output: string;
    /** All of stdout, for a command whose stdout is a result. */
    stdout: string;
    /** Set when the command could not be started, for example because it is not on the PATH. */
    spawnError?: Error;
}

/**
 * Runs a command and collects the tail of its output. With `inherit`, the output goes to stderr,
 * so stdout stays free for the `--json` result.
 */
export function runCommand(
    command: string,
    args: string[],
    options: { cwd: string; inherit?: boolean; env?: NodeJS.ProcessEnv },
): Promise<RunResult> {
    return new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: options.inherit ? ['ignore', process.stderr, process.stderr] : ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let stdout = '';
        const collect = (chunk: Buffer) => {
            output = (output + chunk.toString()).slice(-4000);
        };
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            collect(chunk);
        });
        child.stderr?.on('data', collect);
        child.on('error', spawnError => resolve({ code: null, output, stdout, spawnError }));
        child.on('close', code => resolve({ code, output, stdout }));
    });
}

/** Installs every dependency the project's package.json declares. */
export async function installDependencies(
    packageManager: PackageManager,
    cwd: string,
    logLevel: CliLogLevel,
): Promise<void> {
    const args = packageManager === 'npm' ? ['install', '--loglevel', 'error'] : ['install'];
    const command = `${packageManager} ${args.join(' ')}`;
    const result = await runCommand(packageManager, args, { cwd, inherit: logLevel === 'verbose' });
    if (result.spawnError) {
        throw new CreateError(
            'create.install-failed',
            `Could not run \`${command}\`: ${result.spawnError.message}.`,
            `Install ${packageManager}, or choose another one with --package-manager.`,
        );
    }
    if (result.code !== 0) {
        throw new CreateError(
            'create.install-failed',
            `\`${command}\` failed with exit code ${String(result.code)}.` +
                (result.output.trim() ? `\n\n${result.output.trim()}` : ''),
            `Fix the problem above, then run \`${packageManager} install\` in the project directory.`,
        );
    }
}

export const INITIAL_COMMIT_MESSAGE = 'Initial commit from @vendure/create';

/**
 * Initialises a git repository, without committing. A missing git or a directory that is already
 * inside a repository is reported and never fails create.
 */
export type GitInitResult = Exclude<GitResult, { status: 'committed' }> | { status: 'initialised' };

export async function initGitRepository(cwd: string): Promise<GitInitResult> {
    const version = await runCommand('git', ['--version'], { cwd });
    if (version.spawnError || version.code !== 0) {
        return { status: 'skipped', reason: 'git is not installed' };
    }
    const inside = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    if (inside.code === 0 && inside.output.trim() === 'true') {
        return { status: 'skipped', reason: 'the project directory is already inside a git repository' };
    }
    const init = await runCommand('git', ['init', '--quiet'], { cwd });
    return init.code === 0 ? { status: 'initialised' } : gitFailed('init', init);
}

/** Commits every file of a repository that {@link initGitRepository} created. */
export async function commitAll(cwd: string): Promise<GitResult> {
    for (const args of [
        ['add', '--all'],
        ['commit', '--quiet', '--message', INITIAL_COMMIT_MESSAGE],
    ]) {
        const result = await runCommand('git', args, { cwd });
        if (result.code !== 0) {
            return gitFailed(args[0], result);
        }
    }
    return { status: 'committed' };
}

function gitFailed(step: string, result: RunResult): { status: 'failed'; reason: string } {
    return {
        status: 'failed',
        reason: `\`git ${step}\` failed: ${result.output.trim() || 'exit code ' + String(result.code)}`,
    };
}
