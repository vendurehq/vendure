import { readFileSync } from 'node:fs';

import { DeviceLoginDeniedError, DeviceLoginExpiredError, DeviceLoginPendingError } from './auth-errors.js';
import {
    AuthOptions,
    getPendingLoginLockPath,
    getPendingLoginPath,
    resolveConsoleApiUrl,
} from './auth-options.js';
import {
    AuthStatus,
    CompleteDeviceLoginOptions,
    StartedDeviceLogin,
    completeDeviceLogin,
    readAuthStatus,
    startDeviceLogin,
} from './auth-session.js';
import { removeFile, writePrivateFile } from './auth-store.js';
import { FileLockOptions, withFileLock } from './file-lock.js';

/**
 * A device login that `vendure auth login --json` started, as written to
 * `auth-pending.json`. `deviceCode` completes this login only, and it never
 * leaves the file. One login is pending at a time: a new one replaces it.
 */
interface PendingLoginRecord {
    version: 1;
    consoleApiUrl: string;
    clientId: string;
    workosApiHostname: string;
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    /** Seconds between polls. */
    interval: number;
    /** When the code expires, as epoch milliseconds. */
    expiresAt: number;
    /** The `--organization` the login was started with. */
    organization?: string;
}

/**
 * What a caller shows a person so they can approve the login: the URL with the
 * code filled in, the code, and when it expires as an ISO time.
 *
 * @since 4.0.0
 */
export interface PendingLogin {
    status: 'pending';
    url: string;
    code: string;
    expiresAt: string;
}

/** Why {@link waitForPendingLogin} found nothing to wait for. */
export class NoPendingLoginError extends Error {
    constructor(readonly reason: 'missing' | 'expired') {
        super(
            reason === 'expired'
                ? 'The pending login code expired before it was approved.'
                : 'No login is waiting for approval.',
        );
        this.name = 'NoPendingLoginError';
    }
}

/**
 * A wait holds the lock while it polls, which can last as long as the code
 * lives. A holder that exits is detected by its pid, so this only bounds a
 * holder that hangs.
 */
const PENDING_LOCK_STALE_MS = 30 * 60_000;

/** Writing or replacing the record is quick. */
const PENDING_WRITE_WAIT_MS = 5_000;

/**
 * Starts a device login, saves it to `auth-pending.json` at mode 0600, and
 * returns what a person needs to approve it, without waiting. Replaces a login
 * that is already pending. `organization` is used when the login finishes.
 *
 * @since 4.0.0
 */
export async function startPendingLogin(
    options: AuthOptions & { organization?: string } = {},
): Promise<PendingLogin> {
    const login = await startDeviceLogin(options);
    const now = (options.now ?? Date.now)();
    const record: PendingLoginRecord = {
        version: 1,
        consoleApiUrl: login.consoleApiUrl,
        clientId: login.client.clientId,
        workosApiHostname: login.client.apiHostname,
        deviceCode: login.device.deviceCode,
        userCode: login.device.userCode,
        verificationUri: login.device.verificationUri,
        verificationUriComplete: login.device.verificationUriComplete,
        interval: login.device.interval,
        expiresAt: now + login.device.expiresIn * 1000,
        ...(options.organization ? { organization: options.organization } : {}),
    };
    // A wait that holds the lock is polling the login this replaces. It finds
    // the record gone or replaced when it stops.
    await withFileLock(
        getPendingLoginLockPath(options),
        { staleMs: PENDING_LOCK_STALE_MS, waitMs: PENDING_WRITE_WAIT_MS },
        () => {
            writePrivateFile(getPendingLoginPath(options), JSON.stringify(record, null, 2));
            return Promise.resolve();
        },
    );
    return toPendingLogin(record);
}

export interface WaitForPendingLoginOptions extends Omit<CompleteDeviceLoginOptions, 'organization'> {
    /** How long to wait for approval, in milliseconds. */
    timeoutMs: number;
}

/**
 * Finishes the login that {@link startPendingLogin} saved. Returns the stored
 * login once the code is approved, or the pending login again when `timeoutMs`
 * passes first, keeping it for a later wait.
 *
 * Only one wait polls at a time. Another one waits for it, up to its own
 * timeout, and then reports the login that one stored.
 *
 * @throws NoPendingLoginError when no login is pending, or it expired. An expired one is removed.
 * @throws DeviceLoginDeniedError when the code was denied in the browser. The pending login is removed.
 * @throws DeviceLoginExpiredError when the code expired while waiting. The pending login is removed.
 * @since 4.0.0
 */
export async function waitForPendingLogin(
    options: WaitForPendingLoginOptions,
): Promise<AuthStatus | PendingLogin> {
    const now = options.now ?? Date.now;
    const until = now() + options.timeoutMs;
    const before = readPendingRecord(options);
    if (!before) {
        throw new NoPendingLoginError('missing');
    }
    const lockOptions: FileLockOptions = {
        staleMs: PENDING_LOCK_STALE_MS,
        waitMs: Math.max(0, options.timeoutMs),
    };
    return withFileLock(getPendingLoginLockPath(options), lockOptions, async held => {
        // Re-read: under the lock this is whatever the wait ahead of us left.
        const record = readPendingRecord(options);
        if (!held) {
            // Another wait is still polling this login. Polling too would race it.
            if (record) {
                return toPendingLogin(record);
            }
            throw new NoPendingLoginError('missing');
        }
        if (!record) {
            // The wait ahead of us finished the login we were waiting for.
            const status = readAuthStatus(options);
            if (status.loggedIn && isLoginFrom(before, status)) {
                return status;
            }
            throw new NoPendingLoginError('missing');
        }
        if (record.expiresAt <= now()) {
            removePendingRecord(options, record);
            throw new NoPendingLoginError('expired');
        }
        try {
            const status = await completeDeviceLogin(toStartedLogin(record, now()), {
                ...options,
                organization: record.organization,
                until,
            });
            removePendingRecord(options, record);
            return status;
        } catch (error) {
            if (error instanceof DeviceLoginPendingError) {
                return toPendingLogin(record);
            }
            if (error instanceof DeviceLoginDeniedError || error instanceof DeviceLoginExpiredError) {
                removePendingRecord(options, record);
            }
            throw error;
        }
    });
}

/** The pending login, for showing again. `undefined` when none is pending or it expired. */
export function readPendingLogin(options: AuthOptions = {}): PendingLogin | undefined {
    const record = readPendingRecord(options);
    return record && record.expiresAt > (options.now ?? Date.now)() ? toPendingLogin(record) : undefined;
}

/**
 * The wait ahead of us stored a login for the same Console. Another `auth
 * login` could have stored it instead, but either way it is the login the
 * caller now has.
 */
function isLoginFrom(record: PendingLoginRecord, status: AuthStatus): boolean {
    return status.consoleApiUrl === record.consoleApiUrl && status.clientId === record.clientId;
}

/** Removes the record, unless a newer `auth login --json` has replaced it meanwhile. */
function removePendingRecord(options: AuthOptions, record: PendingLoginRecord): void {
    if (readPendingRecord(options)?.deviceCode === record.deviceCode) {
        removeFile(getPendingLoginPath(options));
    }
}

function toStartedLogin(record: PendingLoginRecord, now: number): StartedDeviceLogin {
    return {
        consoleApiUrl: record.consoleApiUrl,
        client: { clientId: record.clientId, apiHostname: record.workosApiHostname },
        device: {
            deviceCode: record.deviceCode,
            userCode: record.userCode,
            verificationUri: record.verificationUri,
            verificationUriComplete: record.verificationUriComplete,
            interval: record.interval,
            expiresIn: Math.max(0, (record.expiresAt - now) / 1000),
        },
    };
}

function toPendingLogin(record: PendingLoginRecord): PendingLogin {
    return {
        status: 'pending',
        url: record.verificationUriComplete,
        code: record.userCode,
        expiresAt: new Date(record.expiresAt).toISOString(),
    };
}

/**
 * The pending login for the selected Console. A record for another Console,
 * or one that cannot be read, reads as none.
 */
function readPendingRecord(options: AuthOptions): PendingLoginRecord | undefined {
    let value: unknown;
    try {
        value = JSON.parse(readFileSync(getPendingLoginPath(options), 'utf-8'));
    } catch {
        return undefined;
    }
    const record = parsePendingRecord(value);
    if (!record) {
        return undefined;
    }
    return record.consoleApiUrl === resolveConsoleApiUrl(options) ? record : undefined;
}

function parsePendingRecord(value: unknown): PendingLoginRecord | undefined {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const v = value as Record<string, unknown>;
    const strings = [
        'consoleApiUrl',
        'clientId',
        'workosApiHostname',
        'deviceCode',
        'userCode',
        'verificationUri',
        'verificationUriComplete',
    ] as const;
    if (
        v.version !== 1 ||
        strings.some(key => typeof v[key] !== 'string' || v[key] === '') ||
        typeof v.interval !== 'number' ||
        !(v.interval > 0) ||
        typeof v.expiresAt !== 'number' ||
        !Number.isFinite(v.expiresAt) ||
        (v.organization !== undefined && typeof v.organization !== 'string')
    ) {
        return undefined;
    }
    return value as PendingLoginRecord;
}

/** Removes any pending login, for any Console. Returns whether one was there. */
export function clearPendingLogin(options: AuthOptions = {}): boolean {
    return removeFile(getPendingLoginPath(options));
}
