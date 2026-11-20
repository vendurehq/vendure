import type { SpawnOptions, SpawnResult } from '@vendure/common/lib/command';
import crossSpawn from 'cross-spawn';

/**
 * Builds `ctx.spawn`. The process's stdout goes to `forwardStdout`, which the host points at
 * stderr under `--json`. Its stderr always goes to `process.stderr`. The process is stopped
 * when the signal fires.
 */
export function createSpawn(
    cwd: string,
    signal: AbortSignal,
    forwardStdout: (chunk: Buffer) => void,
): (command: string, args: string[], options?: SpawnOptions) => Promise<SpawnResult> {
    return (command, args, options = {}) =>
        new Promise<SpawnResult>((resolve, reject) => {
            const child = crossSpawn(command, args, {
                cwd: options.cwd ?? cwd,
                env: { ...process.env, ...options.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (chunk: Buffer) => {
                stdout += chunk.toString();
                forwardStdout(chunk);
            });
            child.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
                process.stderr.write(chunk);
            });
            const onAbort = () => child.kill('SIGTERM');
            if (signal.aborted) {
                onAbort();
            }
            signal.addEventListener('abort', onAbort, { once: true });
            child.on('error', error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            });
            child.on('close', exitCode => {
                signal.removeEventListener('abort', onAbort);
                resolve({ exitCode, stdout, stderr });
            });
        });
}
