import { COMMAND_ENVELOPE_SCHEMA_VERSION, CommandEnvelope, CommandEvent } from '@vendure/common/lib/command';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

/**
 * How long a child has to stop after the IPC message, before SIGINT goes to its process group.
 * The message lets the command clean up. The signal reaches the processes it started.
 */
const DEFAULT_SIGINT_AFTER_MS = 2_000;

/** How long a child has to stop after SIGINT, before the whole process group is killed. */
const KILL_AFTER_MS = 5_000;

export interface RunToolOptions {
    /** The CLI entry point to run, normally `dist/cli.js`. */
    cliBin: string;
    /** The project directory. */
    cwd: string;
    signal: AbortSignal;
    onEvent(event: CommandEvent): void;
    /** A line the child wrote to stderr that is not an event. */
    onLog(line: string): void;
    /** Overrides {@link DEFAULT_SIGINT_AFTER_MS}. */
    sigintAfterMs?: number;
}

function errorEnvelope(code: string, message: string): CommandEnvelope {
    return {
        schemaVersion: COMMAND_ENVELOPE_SCHEMA_VERSION,
        status: 'error',
        error: { code, exit: 1, message },
        notices: [],
    };
}

/**
 * Runs `vendure <path> --json --input -` in a new child process, with the input on stdin, and
 * returns the envelope the child wrote to stdout. Each call starts clean: no config cache, no
 * ts-node registration and no environment variable carries over from an earlier call.
 *
 * The child starts in its own process group. Cancelling sends a message over IPC, which fires
 * the child's `ctx.signal` on every platform. If the child is still running after a grace period,
 * SIGINT goes to the group, which reaches tsc, docker and package managers the child started.
 */
export function runToolInChild(
    commandPath: string[],
    input: Record<string, unknown>,
    options: RunToolOptions,
): Promise<CommandEnvelope> {
    return new Promise<CommandEnvelope>(resolve => {
        const posix = process.platform !== 'win32';
        const child = spawn(process.execPath, [options.cliBin, ...commandPath, '--json', '--input', '-'], {
            cwd: options.cwd,
            detached: posix,
            stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
            env: { ...process.env, VENDURE_CLI_MCP: '1' },
        });

        let stdout = '';
        const stderrTail: string[] = [];
        let exited = false;

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        readline.createInterface({ input: child.stderr as NodeJS.ReadableStream }).on('line', line => {
            const event = parseEvent(line);
            if (event) {
                options.onEvent(event);
                return;
            }
            stderrTail.push(line);
            if (stderrTail.length > 20) {
                stderrTail.shift();
            }
            options.onLog(line);
        });

        const cancel = () => {
            if (exited) {
                return;
            }
            if (child.connected) {
                child.send({ type: 'cancel' }, () => undefined);
            }
            const sigintAfter = options.sigintAfterMs ?? DEFAULT_SIGINT_AFTER_MS;
            setTimeout(() => {
                if (!exited) {
                    signalGroup('SIGINT');
                }
            }, sigintAfter).unref();
            setTimeout(() => {
                if (!exited) {
                    signalGroup('SIGKILL');
                }
            }, sigintAfter + KILL_AFTER_MS).unref();
        };
        const signalGroup = (name: NodeJS.Signals) => {
            try {
                if (posix && child.pid) {
                    process.kill(-child.pid, name);
                } else {
                    child.kill(name);
                }
            } catch {
                // The process is already gone.
            }
        };
        if (options.signal.aborted) {
            cancel();
        }
        options.signal.addEventListener('abort', cancel, { once: true });

        child.on('error', error => {
            exited = true;
            resolve(errorEnvelope('mcp.child-failed', `Could not start the CLI: ${error.message}`));
        });
        child.on('close', code => {
            exited = true;
            options.signal.removeEventListener('abort', cancel);
            resolve(parseEnvelope(stdout) ?? childFailed(code, stderrTail));
        });

        child.stdin?.on('error', () => undefined);
        child.stdin?.end(JSON.stringify(input));
    });
}

function parseEvent(line: string): CommandEvent | undefined {
    if (!line.startsWith('{')) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(line) as CommandEvent;
        return parsed.vendure === 'event' && typeof parsed.type === 'string' ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function parseEnvelope(stdout: string): CommandEnvelope | undefined {
    try {
        const parsed = JSON.parse(stdout.trim()) as CommandEnvelope;
        return parsed.schemaVersion === COMMAND_ENVELOPE_SCHEMA_VERSION ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function childFailed(code: number | null, stderrTail: string[]): CommandEnvelope {
    const detail = stderrTail.length ? ` ${stderrTail.join(' ').slice(0, 500)}` : '';
    return errorEnvelope(
        'mcp.child-failed',
        `The CLI ended with exit code ${code ?? 'unknown'} without writing a result.${detail}`,
    );
}
