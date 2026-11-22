import { DevServerError, DevServerStatus, DevServerUrls } from './state-file.js';

/** The state of one process of a `vendure dev` run. */
type ChildPhase = 'starting' | 'restarting' | 'ready' | 'failed';

/**
 * Restarts of different processes that begin within this time of each other come from one change,
 * such as one save that restarts both the server and the worker.
 */
export const RESTART_BATCH_MS = 1000;

/** What the supervisor reports on each change. */
export interface DevSupervisorSnapshot {
    status: DevServerStatus;
    urls: DevServerUrls;
    startedAt: string;
    restarts: number;
    lastError: DevServerError | null;
}

/**
 * The state machine of a `vendure dev` run. It tracks each process it runs and combines them into
 * one status:
 *
 * - `starting` until every process has been ready once.
 * - `restarting` while a file change restarts a process.
 * - `ready` when every process is ready.
 * - `failed` when a process exited before it was ready, or crashed after. The run keeps going,
 *   and the next relevant file change restarts the process.
 * - `stopped` once the run has ended.
 *
 * `failed` wins over the others, so `vendure devserver wait` returns as soon as a restart fails.
 * The supervisor does not touch processes or files. It calls `onChange` with a new snapshot
 * whenever the snapshot changes.
 */
export class DevSupervisor {
    private readonly phases = new Map<string, ChildPhase>();
    private readonly startedAt: string;
    private urls: DevServerUrls = {};
    private restarts = 0;
    private lastError: DevServerError | null = null;
    private stopped = false;
    private lastRestartCountedAt = Number.NEGATIVE_INFINITY;
    private lastStatus: DevServerStatus;

    constructor(
        targets: string[],
        private readonly onChange: (snapshot: DevSupervisorSnapshot) => void = () => undefined,
        private readonly now: () => Date = () => new Date(),
    ) {
        for (const target of targets) {
            this.phases.set(target, 'starting');
        }
        this.startedAt = this.now().toISOString();
        this.lastStatus = this.computeStatus();
    }

    get status(): DevServerStatus {
        return this.computeStatus();
    }

    snapshot(): DevSupervisorSnapshot {
        return {
            status: this.computeStatus(),
            urls: { ...this.urls },
            startedAt: this.startedAt,
            restarts: this.restarts,
            lastError: this.lastError,
        };
    }

    /**
     * A file change restarts a process, or starts one that had exited. `restarts` counts the
     * changes: the processes that one save restarts within {@link RESTART_BATCH_MS} count once,
     * and a later save counts again even while a process is still restarting from an earlier one.
     */
    childRestarting(target: string): void {
        if (this.stopped || !this.phases.has(target)) {
            return;
        }
        const now = this.now().getTime();
        const alreadyRestarting = this.phases.get(target) === 'restarting';
        if (!alreadyRestarting && now - this.lastRestartCountedAt > RESTART_BATCH_MS) {
            this.restarts++;
            this.lastRestartCountedAt = now;
        }
        this.phases.set(target, 'restarting');
        this.changed(true);
    }

    childReady(target: string): void {
        if (this.stopped || !this.phases.has(target) || this.phases.get(target) === 'ready') {
            return;
        }
        this.phases.set(target, 'ready');
        if (this.lastError?.process === target) {
            this.lastError = null;
        }
        if (this.computeStatus() === 'ready') {
            this.lastError = null;
        }
        this.changed();
    }

    childFailed(target: string, error: DevServerError): void {
        if (this.stopped || !this.phases.has(target)) {
            return;
        }
        this.phases.set(target, 'failed');
        this.lastError = error;
        this.changed(true);
    }

    addUrls(urls: DevServerUrls): void {
        const next = { ...this.urls, ...urls };
        if (JSON.stringify(next) === JSON.stringify(this.urls)) {
            return;
        }
        this.urls = next;
        this.changed(true);
    }

    stop(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        this.changed(true);
    }

    private computeStatus(): DevServerStatus {
        if (this.stopped) {
            return 'stopped';
        }
        const phases = [...this.phases.values()];
        if (phases.includes('failed')) {
            return 'failed';
        }
        if (phases.includes('restarting')) {
            return 'restarting';
        }
        if (phases.includes('starting')) {
            return 'starting';
        }
        return 'ready';
    }

    private changed(force = false): void {
        const status = this.computeStatus();
        if (force || status !== this.lastStatus) {
            this.lastStatus = status;
            this.onChange(this.snapshot());
        }
    }
}
