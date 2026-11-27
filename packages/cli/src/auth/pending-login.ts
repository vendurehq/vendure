import { createHash, randomBytes } from 'node:crypto';
import { linkSync, readFileSync, renameSync } from 'node:fs';

import {
    DeviceLoginDeniedError,
    DeviceLoginExpiredError,
    DeviceLoginPendingError,
    DeviceLoginReplacedError,
} from './auth-errors.js';
import {
    AuthOptions,
    getFinishedLoginPath,
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

/**
 * How a login that was pending ended, written over its record by the wait that
 * finished it, so a wait queued behind that one reports the same outcome. It
 * names the code by its hash only. A completed login removes this file and
 * `auth-pending.json` instead, and records `completed` only when it cannot.
 */
interface FinishedLoginRecord {
    version: 1;
    consoleApiUrl: string;
    deviceCodeHash: string;
    outcome: 'completed' | 'denied' | 'expired' | 'failed';
    message?: string;
}

/**
 * Starts a device login, saves it to `auth-pending.json` at mode 0600, and
 * returns what a person needs to approve it, without waiting. Replaces a login
 * that is already pending. `organization` is used when the login finishes.
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
    // Not under the wait lock: the write is an atomic rename, and a wait that is
    // polling the login this replaces stops at its next poll.
    writePrivateFile(getPendingLoginPath(options), JSON.stringify(record, null, 2));
    return toPendingLogin(record);
}

export interface WaitForPendingLoginOptions extends Omit<
    CompleteDeviceLoginOptions,
    'organization' | 'onAuthorized' | 'stillWanted'
> {
    /** How long to wait for approval, in milliseconds. */
    timeoutMs: number;
}

/**
 * Finishes the login that {@link startPendingLogin} saved. Returns the stored
 * login once the code is approved, and removes the pending login's files, or
 * the pending login again when `timeoutMs`
 * passes first, keeping it for a later wait. A wait whose login is replaced by
 * a new `auth login --json` returns the new pending login.
 *
 * Only one wait polls at a time. Another one waits for it, up to its own
 * timeout, and then reports how that one ended.
 *
 * @throws NoPendingLoginError when no login is pending, or it expired.
 * @throws DeviceLoginDeniedError when the code was denied in the browser.
 * @throws DeviceLoginExpiredError when the code expired while waiting.
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
            return reportFinishedLogin(before, options);
        }
        if (record.expiresAt <= now()) {
            finishPendingLogin(options, record, 'expired');
            throw new NoPendingLoginError('expired');
        }
        // Once WorkOS has answered with tokens the code is spent, so any later
        // failure ends this pending login too.
        let authorized = false;
        try {
            const status = await completeDeviceLogin(toStartedLogin(record, now()), {
                ...options,
                organization: record.organization,
                until,
                onAuthorized: () => (authorized = true),
                stillWanted: () => readPendingRecord(options)?.deviceCode === record.deviceCode,
            });
            removeCompletedLogin(options, record);
            return status;
        } catch (error) {
            if (error instanceof DeviceLoginPendingError) {
                return toPendingLogin(record);
            }
            if (error instanceof DeviceLoginReplacedError) {
                const replacement = readPendingRecord(options);
                if (replacement) {
                    return toPendingLogin(replacement);
                }
                throw new NoPendingLoginError('missing');
            }
            if (error instanceof DeviceLoginDeniedError) {
                finishPendingLogin(options, record, 'denied');
            } else if (error instanceof DeviceLoginExpiredError) {
                finishPendingLogin(options, record, 'expired');
            } else if (authorized) {
                finishPendingLogin(
                    options,
                    record,
                    'failed',
                    error instanceof Error ? error.message : undefined,
                );
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
 * The wait ahead of us finished the login we were waiting for. It reports the
 * same outcome, so a denied code is never read as the login already stored.
 * A completed login leaves no outcome file: the stored login is its outcome.
 */
function reportFinishedLogin(before: PendingLoginRecord, options: AuthOptions): AuthStatus {
    const finished = readFinishedRecord(options);
    if (finished && finished.deviceCodeHash !== hashDeviceCode(before.deviceCode)) {
        throw new NoPendingLoginError('missing');
    }
    switch (finished?.outcome) {
        case undefined:
        case 'completed': {
            const status = readAuthStatus(options);
            if (status.loggedIn) {
                return status;
            }
            throw new NoPendingLoginError('missing');
        }
        case 'denied':
            throw new DeviceLoginDeniedError();
        case 'expired':
            throw new DeviceLoginExpiredError();
        case 'failed':
            throw new Error(finished.message ?? 'The login failed.');
    }
}

/**
 * Records how the login ended, in its own file, so a wait queued behind this
 * one reports the same outcome. `auth-pending.json` is left alone: a new
 * `auth login --json` may have replaced it meanwhile, and the outcome names
 * this code only, so the record reads as finished without being rewritten.
 */
function finishPendingLogin(
    options: AuthOptions,
    record: PendingLoginRecord,
    outcome: FinishedLoginRecord['outcome'],
    message?: string,
): void {
    const finished: FinishedLoginRecord = {
        version: 1,
        consoleApiUrl: record.consoleApiUrl,
        deviceCodeHash: hashDeviceCode(record.deviceCode),
        outcome,
        ...(message ? { message } : {}),
    };
    writePrivateFile(getFinishedLoginPath(options), JSON.stringify(finished, null, 2));
}

/**
 * Removes the files of a login that is now stored, as `auth logout` does, so no
 * later wait can pick it up. `auth-pending.json` goes only while it still holds
 * this login. The outcome file goes in any case: a wait queued behind this one
 * finds no outcome and reports the stored login.
 */
function removeCompletedLogin(options: AuthOptions, record: PendingLoginRecord): void {
    try {
        removePendingRecordIf(options, record.deviceCode);
        removeFile(getFinishedLoginPath(options));
    } catch {
        // The login is stored, so it must not be reported as failed. Recording
        // the outcome still keeps a later wait from polling the spent code.
        try {
            finishPendingLogin(options, record, 'completed');
        } catch {
            // Nothing more to try.
        }
    }
}

/**
 * Removes `auth-pending.json` while it holds `deviceCode`. A new login is
 * written without the wait lock, so a read followed by an unlink could remove
 * one written in between. Instead the file is renamed away, which takes one
 * version atomically, and a version that is not this login is linked back.
 * `link` never replaces a file, so an even newer login written meanwhile stays.
 * The `.tmp` name lets `writePrivateFile` sweep a copy a killed process left.
 */
function removePendingRecordIf(options: AuthOptions, deviceCode: string): void {
    const file = getPendingLoginPath(options);
    const taken = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.removing.tmp`;
    try {
        renameSync(file, taken);
    } catch {
        return;
    }
    try {
        let value: unknown;
        try {
            value = JSON.parse(readFileSync(taken, 'utf-8'));
        } catch {
            value = undefined;
        }
        if (parsePendingRecord(value)?.deviceCode !== deviceCode) {
            try {
                linkSync(taken, file);
            } catch {
                // A newer login took its place.
            }
        }
    } finally {
        removeFile(taken);
    }
}

function hashDeviceCode(deviceCode: string): string {
    return createHash('sha256').update(deviceCode).digest('hex');
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
    if (!record || record.consoleApiUrl !== resolveConsoleApiUrl(options)) {
        return undefined;
    }
    // A denied, expired or failed login stays in the file until a new one
    // replaces it.
    return readFinishedRecord(options)?.deviceCodeHash === hashDeviceCode(record.deviceCode)
        ? undefined
        : record;
}

function readFinishedRecord(options: AuthOptions): FinishedLoginRecord | undefined {
    let value: unknown;
    try {
        value = JSON.parse(readFileSync(getFinishedLoginPath(options), 'utf-8'));
    } catch {
        return undefined;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const v = value as Record<string, unknown>;
    const outcomes = ['completed', 'denied', 'expired', 'failed'];
    if (
        v.version !== 1 ||
        typeof v.deviceCodeHash !== 'string' ||
        typeof v.outcome !== 'string' ||
        !outcomes.includes(v.outcome) ||
        v.consoleApiUrl !== resolveConsoleApiUrl(options)
    ) {
        return undefined;
    }
    return value as FinishedLoginRecord;
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
    removeFile(getFinishedLoginPath(options));
    return removeFile(getPendingLoginPath(options));
}
