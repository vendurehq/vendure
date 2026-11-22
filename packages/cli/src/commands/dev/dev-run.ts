import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { LogLine } from '@vendure/common/lib/log';
import pc from 'picocolors';

import {
    formatLogLineAsText,
    isReadyLine,
    readChildOutputLine,
    readUrls,
    StartupErrorEvent,
    startupErrorToDevServerError,
} from './child-output.js';
import { parseDiagnostics } from './diagnostics.js';
import { RotatingLogWriter } from './log-writer.js';
import {
    DevServerError,
    DevServerStateFile,
    generateLocalTrustSecret,
    isProcessAlive,
    readDevServerState,
    withoutLocalTrustSecret,
} from './state-file.js';
import { DevSupervisor } from './supervisor.js';

/** How many lines of a process's output are kept to read compile errors from. */
const MAX_BUFFERED_OUTPUT_LINES = 500;

/**
 * Receives what happens to one process of a `vendure dev` run.
 */
export interface DevChildMonitor {
    /** The process is about to be spawned. `restart` is false for the first spawn of the run. */
    onSpawn(restart: boolean): void;
    /** One line of the process's output, without the line ending. */
    onOutput(stream: 'stdout' | 'stderr', line: string): void;
    /**
     * The process exited and the run keeps going: the next relevant file change respawns it.
     * An exit that ends the whole run, or one caused by a restart, is not reported. Returns why the
     * process failed, as one sentence.
     */
    onRecoverableExit(code: number): string;
}

export interface DevRunOptions {
    projectDir: string;
    targets: string[];
    /** Writes the state file. Only a run that starts the server writes it. */
    writeState: boolean;
    /** Writes the readable form of a process's output to the terminal. */
    print: (target: string, stream: 'stdout' | 'stderr', text: string) => void;
    now?: () => Date;
    secret?: string;
}

/**
 * The state, logs and secret of one `vendure dev` run.
 *
 * It owns the supervisor state machine, the single writer of `.vendure/devserver.json`, and the
 * writer of `.vendure/logs/dev.jsonl`. Each process of the run reports to it through its
 * {@link DevChildMonitor}.
 */
export class DevRun {
    readonly supervisor: DevSupervisor;
    private readonly secret: string;
    private readonly stateFile: DevServerStateFile | undefined;
    private readonly logWriter: RotatingLogWriter;
    private ended = false;

    constructor(private readonly options: DevRunOptions) {
        this.secret = options.secret ?? generateLocalTrustSecret();
        this.stateFile = options.writeState
            ? new DevServerStateFile(options.projectDir, this.secret)
            : undefined;
        this.logWriter = new RotatingLogWriter(options.projectDir);
        this.supervisor = new DevSupervisor(
            options.targets,
            snapshot => {
                if (!this.ended && snapshot.status !== 'stopped') {
                    this.stateFile?.write({ ...snapshot, pid: process.pid });
                }
            },
            options.now,
        );
        this.stateFile?.write({ ...this.supervisor.snapshot(), pid: process.pid });
    }

    /**
     * The environment of a process of the run. Every process gets `VENDURE_PROCESS`, the server
     * and the worker log in the `json` format, and only the server gets the local-trust secret.
     */
    childEnv(target: string, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            ...withoutLocalTrustSecret(baseEnv),
            VENDURE_PROCESS: target,
        };
        if (target === 'server' || target === 'worker') {
            env.VENDURE_LOG_FORMAT = 'json';
        }
        if (target === 'server' && this.stateFile) {
            env[LOCAL_TRUST_SECRET_ENV_VAR] = this.secret;
        }
        return env;
    }

    monitor(target: string): DevChildMonitor {
        return new ChildMonitor(target, this.options, this.supervisor, line => this.writeLog(line));
    }

    /**
     * Ends the run: deletes the state file if it still holds this run's secret, and closes the log.
     */
    end(): void {
        if (this.ended) {
            return;
        }
        this.supervisor.stop();
        this.ended = true;
        try {
            this.stateFile?.remove();
        } finally {
            this.logWriter.close();
        }
    }

    private writeLog(line: LogLine) {
        try {
            this.logWriter.write(line);
        } catch {
            // A full disk or a deleted log directory must not stop the run. The terminal still
            // shows every line.
        }
    }
}

/**
 * Refuses to start a run that would write the state file while another live run holds it.
 */
export function assertNoOtherDevRun(projectDir: string): void {
    const state = readDevServerState(projectDir);
    if (state && state.pid !== process.pid && isProcessAlive(state.pid)) {
        throw new Error(
            `vendure dev is already running for this project (process ${state.pid}). ` +
                'Stop it with "vendure devserver stop" first.',
        );
    }
}

class ChildMonitor implements DevChildMonitor {
    private output: string[] = [];
    private startupError: StartupErrorEvent | undefined;

    constructor(
        private readonly target: string,
        private readonly options: DevRunOptions,
        private readonly supervisor: DevSupervisor,
        private readonly writeLog: (line: LogLine) => void,
    ) {}

    onSpawn(restart: boolean): void {
        this.output = [];
        this.startupError = undefined;
        if (restart) {
            this.supervisor.childRestarting(this.target);
        }
    }

    onOutput(stream: 'stdout' | 'stderr', raw: string): void {
        const read = readChildOutputLine(raw, stream, this.target, this.options.now);
        this.writeLog(read.line);
        if (read.kind === 'startup-error') {
            this.startupError = read.event;
            this.options.print(this.target, 'stderr', formatStartupError(read.event));
            return;
        }
        // A line the child wrote as JSON is shown as text. Any other line is shown as it was
        // written, so the colours of tools such as Vite stay.
        this.options.print(this.target, stream, read.json ? formatLogLineAsText(read.line) : raw);
        this.bufferOutput(read.line);
        this.supervisor.addUrls(readUrls(this.target, read.line));
        if (isReadyLine(this.target, read.line)) {
            this.supervisor.childReady(this.target);
        }
    }

    onRecoverableExit(code: number): string {
        const error = this.describeFailure(code);
        this.supervisor.childFailed(this.target, error);
        return error.message;
    }

    private bufferOutput(line: LogLine) {
        this.output.push(line.stack ? `${line.msg}\n${line.stack}` : line.msg);
        if (this.output.length > MAX_BUFFERED_OUTPUT_LINES) {
            this.output.shift();
        }
    }

    private describeFailure(code: number): DevServerError {
        if (this.startupError) {
            return startupErrorToDevServerError(this.startupError, this.target);
        }
        const diagnostics = parseDiagnostics(this.output.join('\n'), this.options.projectDir);
        if (diagnostics.length) {
            const count =
                diagnostics.length === 1 ? '1 compile error' : `${diagnostics.length} compile errors`;
            return {
                process: this.target,
                message: `The ${this.target} failed to compile: ${count}`,
                diagnostics,
            };
        }
        return { process: this.target, message: `The ${this.target} exited with code ${code}` };
    }
}

function formatStartupError(event: StartupErrorEvent): string {
    const lines = [`${pc.red('error')} ${pc.gray(`(${event.code})`)} ${pc.red(event.message)}`];
    for (const fix of event.fix ?? []) {
        lines.push(`  ${pc.green('fix:')} ${fix.description}`);
    }
    return lines.join('\n');
}
