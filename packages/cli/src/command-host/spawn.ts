import type { SpawnOptions, SpawnResult } from '@vendure/common/lib/command';
import crossSpawn from 'cross-spawn';

import { withoutLocalTrustSecret } from '../shared/local-trust-env.js';

/**
 * Passes on only whole lines, and ends the last one with a newline when the stream closes. Under
 * `--json` a spawned process shares stderr with the host's event lines, and a chunk without a
 * trailing newline would join the next event onto its line.
 */
class LineWriter {
    private pending = '';

    constructor(private readonly write: (text: string) => void) {}

    push(chunk: string): void {
        const text = this.pending + chunk;
        const end = text.lastIndexOf('\n');
        if (end === -1) {
            this.pending = text;
            return;
        }
        this.pending = text.slice(end + 1);
        this.write(text.slice(0, end + 1));
    }

    flush(): void {
        if (this.pending) {
            this.write(`${this.pending}\n`);
            this.pending = '';
        }
    }
}

/**
 * Builds `ctx.spawn`. The process's stdout goes to `forwardStdout`, which the host points at
 * stderr under `--json`. Its stderr always goes to `process.stderr`. With `wholeLines`, both are
 * passed on in whole lines. The process is stopped when the signal fires.
 */
export function createSpawn(
    cwd: string,
    signal: AbortSignal,
    forwardStdout: (text: string) => void,
    { wholeLines = false }: { wholeLines?: boolean } = {},
): (command: string, args: string[], options?: SpawnOptions) => Promise<SpawnResult> {
    return (command, args, options = {}) =>
        new Promise<SpawnResult>((resolve, reject) => {
            const child = crossSpawn(command, args, {
                cwd: options.cwd ?? cwd,
                // The local-trust secret is only for the server of a `vendure dev` run, which that
                // run passes itself. Nothing started through `ctx.spawn` inherits it from the shell.
                env: { ...withoutLocalTrustSecret(process.env), ...options.env },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            const quiet = options.quiet === true;
            const writeStderr = (text: string) => process.stderr.write(text);
            const out = wholeLines ? new LineWriter(forwardStdout) : undefined;
            const err = wholeLines ? new LineWriter(writeStderr) : undefined;
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                stdout += text;
                if (quiet) {
                    return;
                }
                if (out) {
                    out.push(text);
                } else {
                    forwardStdout(text);
                }
            });
            child.stderr?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                stderr += text;
                if (quiet) {
                    return;
                }
                if (err) {
                    err.push(text);
                } else {
                    writeStderr(text);
                }
            });
            let timedOut = false;
            const timer =
                options.timeoutMs === undefined
                    ? undefined
                    : setTimeout(() => {
                          timedOut = true;
                          child.kill('SIGTERM');
                      }, options.timeoutMs);
            const onAbort = () => child.kill('SIGTERM');
            if (signal.aborted) {
                onAbort();
            }
            signal.addEventListener('abort', onAbort, { once: true });
            child.on('error', error => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                reject(error);
            });
            child.on('close', exitCode => {
                clearTimeout(timer);
                signal.removeEventListener('abort', onAbort);
                out?.flush();
                err?.flush();
                resolve({
                    exitCode: timedOut ? null : exitCode,
                    stdout,
                    stderr,
                    ...(timedOut ? { timedOut } : {}),
                });
            });
        });
}
