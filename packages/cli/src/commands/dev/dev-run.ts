import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { LogLine } from '@vendure/common/lib/log';
import pc from 'picocolors';

import {
    formatLogLineAsText,
    isReadyLine,
    isWelcomeEndLine,
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
    withoutLocalTrustSecret,
} from './state-file.js';
import { DevSupervisor, DevSupervisorSnapshot } from './supervisor.js';

/** How many lines of a process's output are kept to read compile errors from. */
const MAX_BUFFERED_OUTPUT_LINES = 500;
/**
 * How long after its "now running" line the server counts as ready without the line that closes
 * its welcome message.
 */
const WELCOME_MESSAGE_TIMEOUT_MS = 1000;

/**
 * Receives what happens to one process of a `vendure dev` run.
 */
export interface DevChildMonitor {
    /**
     * A file change will restart the process, or start it again after it exited. Called when the
     * change is seen, before the old process is stopped, so the state says `restarting` at once.
     */
    onChangeDetected(): void;
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
    /**
     * Writes the state file and the dev log. Only a run that starts the server does, so a second
     * run in another terminal, such as `vendure dev dashboard`, leaves both alone.
     */
    writeState: boolean;
    /** Writes the readable form of a process's output to the terminal. */
    print: (target: string, stream: 'stdout' | 'stderr', text: string) => void;
    /** Reports a problem of the run itself, such as a state file that cannot be written. */
    warn?: (message: string) => void;
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
    private readonly logWriter: RotatingLogWriter | undefined;
    private readonly warned = new Set<string>();
    private ended = false;

    /**
     * Throws {@link DevRunAlreadyRunningError} when the run writes the state file and another live
     * run holds it.
     */
    constructor(private readonly options: DevRunOptions) {
        this.secret = options.secret ?? generateLocalTrustSecret();
        this.stateFile = options.writeState
            ? new DevServerStateFile(options.projectDir, this.secret)
            : undefined;
        this.supervisor = new DevSupervisor(
            options.targets,
            snapshot => this.writeState(snapshot),
            options.now,
        );
        this.stateFile?.claim({ ...this.supervisor.snapshot(), pid: process.pid });
        this.logWriter = options.writeState ? new RotatingLogWriter(options.projectDir) : undefined;
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
            this.logWriter?.close();
        }
    }

    private writeState(snapshot: DevSupervisorSnapshot) {
        if (this.ended || snapshot.status === 'stopped') {
            return;
        }
        try {
            this.stateFile?.write({ ...snapshot, pid: process.pid });
        } catch (e) {
            this.warnOnce('state', `Could not write .vendure/devserver.json: ${(e as Error).message}`);
        }
    }

    private writeLog(line: LogLine) {
        try {
            this.logWriter?.write(line);
        } catch (e) {
            // A full disk or a deleted log directory must not stop the run. The terminal still
            // shows every line.
            this.warnOnce('log', `Could not write .vendure/logs/dev.jsonl: ${(e as Error).message}`);
        }
    }

    private warnOnce(key: string, message: string) {
        if (!this.warned.has(key)) {
            this.warned.add(key);
            this.options.warn?.(message);
        }
    }
}

class ChildMonitor implements DevChildMonitor {
    private output: string[] = [];
    private startupError: StartupErrorEvent | undefined;
    private welcomeTimer: NodeJS.Timeout | undefined;

    constructor(
        private readonly target: string,
        private readonly options: DevRunOptions,
        private readonly supervisor: DevSupervisor,
        private readonly writeLog: (line: LogLine) => void,
    ) {}

    onChangeDetected(): void {
        this.cancelWelcomeTimer();
        this.supervisor.childRestarting(this.target);
    }

    onSpawn(restart: boolean): void {
        this.output = [];
        this.startupError = undefined;
        this.cancelWelcomeTimer();
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
        if (this.welcomeTimer && isWelcomeEndLine(read.line)) {
            this.markReady();
        } else if (isReadyLine(this.target, read.line)) {
            if (this.target === 'server') {
                // The server prints its URLs after the "now running" line, so it counts as ready
                // once the line that closes its welcome message has arrived.
                this.cancelWelcomeTimer();
                this.welcomeTimer = setTimeout(() => this.markReady(), WELCOME_MESSAGE_TIMEOUT_MS);
                this.welcomeTimer.unref?.();
            } else {
                this.markReady();
            }
        }
    }

    onRecoverableExit(code: number): string {
        this.cancelWelcomeTimer();
        const error = this.describeFailure(code);
        this.supervisor.childFailed(this.target, error);
        return error.message;
    }

    private markReady() {
        this.cancelWelcomeTimer();
        this.supervisor.childReady(this.target);
    }

    private cancelWelcomeTimer() {
        if (this.welcomeTimer) {
            clearTimeout(this.welcomeTimer);
            this.welcomeTimer = undefined;
        }
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
