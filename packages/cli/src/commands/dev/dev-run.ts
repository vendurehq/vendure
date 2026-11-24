import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { LogLine, StartupErrorEvent } from '@vendure/common/lib/log';
import pc from 'picocolors';

import { withoutLocalTrustSecret } from '../../shared/local-trust-env.js';

import {
    formatLogLineAsText,
    isReadyLine,
    readChildOutputLine,
    readUrls,
    readyEventUrls,
    startupErrorToDevServerError,
} from './child-output.js';
import { parseDiagnostics } from './diagnostics.js';
import { RotatingLogWriter } from './log-writer.js';
import {
    DevRunAlreadyRunningError,
    DevServerError,
    DevServerStateFile,
    DevServerUrls,
    generateLocalTrustSecret,
} from './state-file.js';
import { DevSupervisor, DevSupervisorSnapshot } from './supervisor.js';

/** How many lines of a process's output are kept to read compile errors from. */
const MAX_BUFFERED_OUTPUT_LINES = 500;
/**
 * How long after its "now running" or "ready" log line the server or the worker counts as ready
 * when it writes no ready event, as a `@vendure/core` from before the event does.
 */
const READY_EVENT_TIMEOUT_MS = 1000;

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
    /**
     * Whether the process reported a startup error since it was spawned. Such a process failed to
     * start even when it then exits with code 0, so the run keeps going and waits for a change.
     */
    hasStartupError(): boolean;
}

/**
 * Set by `vendure devserver start` for the detached run. Its terminal is a file, so the run does
 * not print its processes' output there: the dev log already holds every line, and rotates.
 */
export const DEVSERVER_DETACHED_ENV_VAR = 'VENDURE_DEVSERVER_DETACHED';

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
    /**
     * Fails when the state file cannot be created, instead of running without it. A run started
     * by `vendure devserver start` sets this, because without the file nothing can find or stop it.
     */
    requireStateFile?: boolean;
    now?: () => Date;
    secret?: string;
}

/**
 * The state, logs and secret of one `vendure dev` run.
 *
 * It owns the supervisor state machine, the single writer of the state file, and the
 * writer of `.vendure/logs/dev.jsonl`. Each process of the run reports to it through its
 * {@link DevChildMonitor}.
 */
export class DevRun {
    readonly supervisor: DevSupervisor;
    private readonly secret: string;
    private stateFile: DevServerStateFile | undefined;
    private readonly logWriter: RotatingLogWriter | undefined;
    private readonly warned = new Set<string>();
    private ended = false;

    /**
     * Throws {@link DevRunAlreadyRunningError} when the run writes the state file and another live
     * run holds it.
     */
    constructor(private readonly options: DevRunOptions) {
        this.secret = options.secret ?? generateLocalTrustSecret();
        this.supervisor = new DevSupervisor(
            options.targets,
            snapshot => this.writeState(snapshot),
            options.now,
        );
        try {
            // Inside the try: on Windows without LOCALAPPDATA the state file has no path.
            this.stateFile = options.writeState
                ? new DevServerStateFile(options.projectDir, this.secret)
                : undefined;
            this.stateFile?.claim({ ...this.supervisor.snapshot(), pid: process.pid });
        } catch (e) {
            if (e instanceof DevRunAlreadyRunningError || options.requireStateFile) {
                throw e;
            }
            // The run works without its state file, as `vendure dev` always has. Without the file
            // the server cannot check a secret, so none is passed.
            this.stateFile = undefined;
            this.warnOnce(
                'state',
                'Could not create the dev server state file, so vendure devserver and local trust ' +
                    `are not available for this run: ${(e as Error).message}`,
            );
        }
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
        delete env[DEVSERVER_DETACHED_ENV_VAR];
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
            this.warnOnce('state', `Could not write the dev server state file: ${(e as Error).message}`);
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
    private fallbackTimer: NodeJS.Timeout | undefined;
    /** Whether this process has written a ready event, so its log lines no longer decide readiness. */
    private writesReadyEvent = false;

    constructor(
        private readonly target: string,
        private readonly options: DevRunOptions,
        private readonly supervisor: DevSupervisor,
        private readonly writeLog: (line: LogLine) => void,
    ) {}

    onChangeDetected(): void {
        this.cancelFallbackTimer();
        this.supervisor.childRestarting(this.target);
    }

    onSpawn(restart: boolean): void {
        this.output = [];
        this.startupError = undefined;
        this.cancelFallbackTimer();
        if (restart) {
            this.supervisor.childRestarting(this.target);
        }
    }

    onOutput(stream: 'stdout' | 'stderr', raw: string): void {
        const read = readChildOutputLine(raw, stream, this.target, this.options.now);
        this.writeLog(read.line);
        if (read.kind === 'startup-error') {
            // The process failed to start, whether or not it exits afterwards: an entry point that
            // catches the error and logs it keeps the process alive. The next file change restarts
            // it either way.
            this.startupError = read.event;
            this.cancelFallbackTimer();
            this.supervisor.childFailed(this.target, startupErrorToDevServerError(read.event, this.target));
            this.options.print(this.target, 'stderr', formatStartupError(read.event));
            return;
        }
        if (read.kind === 'ready') {
            this.writesReadyEvent = true;
            this.supervisor.addUrls(this.readUrls(read.line, readyEventUrls(read.event)));
            this.markReady();
            return;
        }
        // A line the child wrote as JSON is shown as text. Any other line is shown as it was
        // written, so the colours of tools such as Vite stay.
        this.options.print(this.target, stream, read.json ? formatLogLineAsText(read.line) : raw);
        this.bufferOutput(read.line);
        this.supervisor.addUrls(this.readUrls(read.line));
        if (!isReadyLine(this.target, read.line)) {
            return;
        }
        if (this.target === 'dashboard') {
            this.markReady();
        } else if (!this.writesReadyEvent) {
            // A core that writes the ready event writes it straight after this line, and the event
            // marks the process ready. A core from before the event never writes it, and the
            // process counts as ready once its welcome message has had time to print its URLs.
            this.cancelFallbackTimer();
            this.fallbackTimer = setTimeout(() => this.markReady(), READY_EVENT_TIMEOUT_MS);
            this.fallbackTimer.unref?.();
        }
    }

    onRecoverableExit(code: number): string {
        this.cancelFallbackTimer();
        const error = this.describeFailure(code);
        this.supervisor.childFailed(this.target, error);
        return error.message;
    }

    /**
     * The URLs a line names. When the run includes the server, the Dashboard URL comes from the
     * server's welcome message only, so it does not depend on which process printed last.
     */
    private readUrls(line: LogLine, urls: DevServerUrls = readUrls(this.target, line)) {
        if (this.target === 'dashboard' && this.options.targets.includes('server')) {
            return {};
        }
        return urls;
    }

    hasStartupError(): boolean {
        return this.startupError !== undefined;
    }

    private markReady() {
        this.cancelFallbackTimer();
        this.supervisor.childReady(this.target);
    }

    private cancelFallbackTimer() {
        if (this.fallbackTimer) {
            clearTimeout(this.fallbackTimer);
            this.fallbackTimer = undefined;
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
