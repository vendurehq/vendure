import type { Fix } from '@vendure/common/lib/command';
import {
    LocalAppDataNotSetError,
    LocalTrustState,
    localTrustStatePath,
} from '@vendure/common/lib/local-trust';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
    closeSync,
    existsSync,
    linkSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeSync,
} from 'node:fs';
import path from 'node:path';

/**
 * The status of a `vendure dev` run. `starting` until every process it runs is ready the first
 * time, `restarting` while a file change restarts a process, `failed` when a process exited
 * before it was ready or crashed later, and `stopped` once the run has ended.
 */
export const DEV_SERVER_STATUSES = ['starting', 'ready', 'restarting', 'failed', 'stopped'] as const;

export type DevServerStatus = (typeof DEV_SERVER_STATUSES)[number];

/**
 * The URLs the run serves. A URL is present once the process that serves it has reported it.
 */
export interface DevServerUrls {
    admin?: string;
    shop?: string;
    mcp?: string;
    dashboard?: string;
}

/**
 * One compile error, read from the TypeScript or SWC output of a process.
 */
export interface DevServerDiagnostic {
    /** The path of the file, as the compiler printed it. */
    file: string;
    line: number;
    column?: number;
    message: string;
    /** The TypeScript error code, for example `TS2322`. SWC errors have none. */
    code?: string;
}

/**
 * Why the run is `failed`.
 */
export interface DevServerError {
    /** The process that failed, for example `server`. */
    process: string;
    /** The namespaced code of a startup error, for example `core.config.invalid-custom-fields`. */
    code?: string;
    message: string;
    diagnostics?: DevServerDiagnostic[];
    fix?: Fix[];
}

/**
 * The state file of a `vendure dev` run, at {@link localTrustStatePath}: `.vendure/devserver.json` in
 * the project directory, or a file in `%LOCALAPPDATA%` on Windows. The run that serves the project is
 * its only writer.
 */
export interface DevServerState extends LocalTrustState {
    status: DevServerStatus;
    urls: DevServerUrls;
    /** When the run started, as an ISO 8601 string. */
    startedAt: string;
    /** How many times a file change restarted the processes. */
    restarts: number;
    lastError: DevServerError | null;
    /** The process ID of the `vendure dev` run. */
    pid: number;
}

/**
 * What `vendure devserver status` reports: the state without the secret and the pid.
 * `startedAt` is `null` when no run has written a state file.
 */
export interface DevServerStatusReport {
    status: DevServerStatus;
    urls: DevServerUrls;
    startedAt: string | null;
    restarts: number;
    lastError: DevServerError | null;
}

/**
 * Throws `LocalAppDataNotSetError` on Windows when `LOCALAPPDATA` is not set.
 */
export function getDevServerStateFilePath(projectDir: string): string {
    return localTrustStatePath(projectDir);
}

/**
 * Generates the local-trust secret of one `vendure dev` run.
 */
export function generateLocalTrustSecret(): string {
    return randomBytes(32).toString('base64url');
}

/**
 * Reads the state file. Returns `undefined` when there is no file, it is not a state file, or, on
 * Windows without `LOCALAPPDATA`, there is nowhere for it to be.
 */
export function readDevServerState(projectDir: string): DevServerState | undefined {
    let filePath: string;
    try {
        filePath = getDevServerStateFilePath(projectDir);
    } catch (e) {
        if (e instanceof LocalAppDataNotSetError) {
            return undefined;
        }
        throw e;
    }
    return readStateFileAt(filePath);
}

function readStateFileAt(filePath: string): DevServerState | undefined {
    let text: string;
    try {
        text = readFileSync(filePath, 'utf-8');
    } catch {
        return undefined;
    }
    try {
        const parsed = JSON.parse(text);
        if (isDevServerState(parsed)) {
            return parsed;
        }
    } catch {
        // A file that does not parse is not a state file this CLI wrote.
    }
    return undefined;
}

function isDevServerState(value: unknown): value is DevServerState {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const state = value as Record<string, unknown>;
    return (
        DEV_SERVER_STATUSES.includes(state.status as DevServerStatus) &&
        typeof state.secret === 'string' &&
        typeof state.pid === 'number' &&
        typeof state.startedAt === 'string' &&
        typeof state.restarts === 'number' &&
        typeof state.urls === 'object' &&
        state.urls !== null
    );
}

/**
 * Whether a process with this ID is running. A process owned by another user counts as running.
 * Use {@link isDevRunAlive} to ask whether the run that wrote a state file is still running.
 */
export function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (e: unknown) {
        return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
}

/** How far the start of a process may lie after the run's `startedAt`, for the rounding of `ps`. */
const START_TIME_TOLERANCE_MS = 2000;

/**
 * Whether the run that wrote a state file is still running.
 *
 * The pid alone is not enough: after a crash or a reboot the file stays behind, and the operating
 * system can give its pid to an unrelated process. The run's process started before it wrote
 * `startedAt`, so a process that started later is a different one. A process of another user is
 * never the run, because the file is only readable by the user who wrote it. Where `ps` cannot
 * report the start time, as on Windows, the pid is trusted.
 */
export function isDevRunAlive(state: Pick<DevServerState, 'pid' | 'startedAt'>, now = Date.now()): boolean {
    if (!Number.isInteger(state.pid) || state.pid <= 0) {
        return false;
    }
    try {
        process.kill(state.pid, 0);
    } catch {
        // ESRCH: no such process. EPERM: a process of another user.
        return false;
    }
    const elapsedSeconds = readProcessElapsedSeconds(state.pid);
    const runStartedAt = Date.parse(state.startedAt);
    if (elapsedSeconds === undefined || Number.isNaN(runStartedAt)) {
        return true;
    }
    return now - elapsedSeconds * 1000 <= runStartedAt + START_TIME_TOLERANCE_MS;
}

/** Where `ps` is on macOS and Linux. */
const PS_PATHS = ['/bin/ps', '/usr/bin/ps'];

function readProcessElapsedSeconds(pid: number): number | undefined {
    if (process.platform === 'win32') {
        return undefined;
    }
    // By absolute path, so that no directory on the PATH can stand in for it.
    const psPath = PS_PATHS.find(candidate => existsSync(candidate));
    if (!psPath) {
        return undefined;
    }
    try {
        const output = execFileSync(psPath, ['-o', 'etime=', '-p', String(pid)], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseElapsedTime(output);
    } catch {
        return undefined;
    }
}

/**
 * Reads the elapsed time that `ps -o etime=` prints, `[[dd-]hh:]mm:ss`, as seconds.
 */
export function parseElapsedTime(text: string): number | undefined {
    const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const [, days, hours, minutes, seconds] = match;
    return ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

/**
 * The state as `vendure devserver status` reports it: without the secret and the pid, and
 * `stopped` when the run that wrote the file is no longer running.
 */
export function toStatusReport(state: DevServerState | undefined): DevServerStatusReport {
    if (!state) {
        return { status: 'stopped', urls: {}, startedAt: null, restarts: 0, lastError: null };
    }
    const report: DevServerStatusReport = {
        status: state.status,
        urls: state.urls,
        startedAt: state.startedAt,
        restarts: state.restarts,
        lastError: state.lastError ?? null,
    };
    return isDevRunAlive(state) ? report : { ...report, status: 'stopped' };
}

/**
 * The single writer of the state file of one `vendure dev` run.
 *
 * Each write goes to a new temporary file, created with the `wx` flag and mode 0600, which is then
 * renamed over the state file. A reader never sees a partial file. On macOS and Linux the mode keeps
 * the secret from other users. Windows ignores the mode: the file takes the permissions of the
 * `%LOCALAPPDATA%` directory it is in, which by default only the user, SYSTEM and administrators
 * can read. Nothing checks those permissions.
 */
export class DevServerStateFile {
    private readonly filePath: string;
    private writes = 0;

    constructor(
        private readonly projectDir: string,
        private readonly secret: string,
    ) {
        this.filePath = getDevServerStateFilePath(projectDir);
    }

    /**
     * Creates the state file for this run. It fails with {@link DevRunAlreadyRunningError} when the
     * file belongs to another run that is still running. A file left behind by a run that is gone
     * is replaced.
     *
     * The file is created with a hard link from the temporary file, which fails when the file
     * already exists, so of two runs that start at the same moment only one creates it.
     */
    claim(state: Omit<DevServerState, 'secret'>): void {
        for (let attempt = 0; attempt < 3; attempt++) {
            const tempPath = this.writeTemporaryFile(state);
            try {
                linkSync(tempPath, this.filePath);
                return;
            } catch (e: unknown) {
                if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw e;
                }
            } finally {
                unlinkIfExists(tempPath);
            }
            const existing = readDevServerState(this.projectDir);
            // A file that names this process was left by an earlier process that had the same pid,
            // as happens when a container restarts: this run has not written the file yet.
            if (existing && existing.pid !== process.pid && isDevRunAlive(existing)) {
                throw new DevRunAlreadyRunningError(existing.pid);
            }
            this.removeStaleFile(existing?.secret);
        }
        throw new Error(`Could not create ${this.filePath}, because another process keeps writing it.`);
    }

    /**
     * Replaces the state file with a new state.
     */
    write(state: Omit<DevServerState, 'secret'>): void {
        const tempPath = this.writeTemporaryFile(state);
        try {
            renameSync(tempPath, this.filePath);
        } catch (e) {
            unlinkIfExists(tempPath);
            throw e;
        }
    }

    /**
     * Removes a state file that was read as stale. Another run may have replaced it in the
     * meantime, so the file is first moved aside, and put back when it is no longer the file that
     * was read.
     */
    private removeStaleFile(staleSecret: string | undefined) {
        const movedPath = `${this.filePath}.${process.pid}.${++this.writes}.stale`;
        try {
            renameSync(this.filePath, movedPath);
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
                return;
            }
            throw e;
        }
        try {
            if (readStateFileAt(movedPath)?.secret !== staleSecret) {
                // The link fails when yet another file is in place, which then stays.
                linkSync(movedPath, this.filePath);
            }
        } catch {
            // Nothing to put back.
        } finally {
            unlinkIfExists(movedPath);
        }
    }

    private writeTemporaryFile(state: Omit<DevServerState, 'secret'>): string {
        // On Windows the first run creates %LOCALAPPDATA%\Vendure\devserver.
        mkdirSync(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.${++this.writes}.tmp`;
        const fd = openSync(tempPath, 'wx', 0o600);
        try {
            writeSync(fd, JSON.stringify({ ...state, secret: this.secret }, null, 2) + '\n');
        } finally {
            closeSync(fd);
        }
        return tempPath;
    }

    /**
     * Deletes the state file, but only while it still holds this run's secret. A newer run that
     * has since written the file keeps it.
     */
    remove(): void {
        if (readDevServerState(this.projectDir)?.secret === this.secret) {
            unlinkIfExists(this.filePath);
        }
    }
}

function unlinkIfExists(filePath: string) {
    try {
        unlinkSync(filePath);
    } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw e;
        }
    }
}

/**
 * Thrown when a `vendure dev` run starts while another live run holds the state file.
 */
export class DevRunAlreadyRunningError extends Error {
    constructor(readonly pid: number) {
        super(
            `vendure dev is already running for this project (process ${pid}). ` +
                'Stop it with "vendure devserver stop" first.',
        );
    }
}
