import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export interface FileLockOptions {
    /**
     * How long a lock file may go untouched before a waiter breaks it. Must
     * exceed the worst-case runtime of the guarded work, or live locks get
     * broken and the mutex stops holding.
     */
    staleMs: number;
    /** How long to wait for the holder before giving up and running unlocked. */
    waitMs: number;
    pollMs?: number;
    /**
     * Called at most once, when the wait has gone on long enough to look like a
     * hang. A command that prints nothing while it queues is indistinguishable
     * from a stuck one.
     */
    onWait?: () => void;
    waitNoticeMs?: number;
}

const DEFAULT_POLL_MS = 50;
const DEFAULT_WAIT_NOTICE_MS = 2_000;

/**
 * Best-effort advisory mutex between concurrent `vendure` processes, built on
 * the atomicity of `open(O_CREAT | O_EXCL)`.
 *
 * "Best effort" is the important part: if the lock cannot be taken (wait
 * exhausted, read-only config dir, unsupported filesystem) `fn` still runs,
 * unserialized. It removes the common race; it does not guarantee exclusion.
 *
 * `fn` therefore receives whether the lock was actually held. Anything whose
 * consequences are unacceptable when two processes do it at once, such as
 * discarding stored credentials, must be gated on that flag.
 */
export async function withFileLock<T>(
    lockFile: string,
    options: FileLockOptions,
    fn: (held: boolean) => Promise<T>,
): Promise<T> {
    const owner = await acquireLock(lockFile, options);
    try {
        return await fn(owner !== undefined);
    } finally {
        if (owner) {
            releaseLock(lockFile, owner);
        }
    }
}

async function acquireLock(lockFile: string, options: FileLockOptions): Promise<string | undefined> {
    const owner = `${process.pid}-${randomBytes(8).toString('hex')}`;
    const startedAt = Date.now();
    const deadline = startedAt + options.waitMs;
    const noticeAt = startedAt + (options.waitNoticeMs ?? DEFAULT_WAIT_NOTICE_MS);
    let noticed = false;
    // On a fresh machine the directory does not exist yet, and the create below
    // would fail with ENOENT and run unlocked.
    try {
        mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
    } catch {
        return undefined;
    }

    while (true) {
        try {
            writeFileSync(lockFile, owner, { flag: 'wx', mode: 0o600 });
            return owner;
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') {
                return undefined;
            }
        }

        if (isStale(lockFile, options.staleMs)) {
            removeLock(lockFile);
            continue;
        }

        if (Date.now() >= deadline) {
            return undefined;
        }

        if (!noticed && options.onWait && Date.now() >= noticeAt) {
            noticed = true;
            try {
                options.onWait();
            } catch {
                // Progress reporting must never stop the guarded work.
            }
        }

        await sleep(options.pollMs ?? DEFAULT_POLL_MS);
    }
}

function releaseLock(lockFile: string, owner: string): void {
    // Only drop the lock while we still hold it: another process may have
    // broken ours as stale and taken its own.
    try {
        if (readFileSync(lockFile, 'utf-8') !== owner) {
            return;
        }
    } catch {
        return;
    }
    removeLock(lockFile);
}

function isStale(lockFile: string, staleMs: number): boolean {
    try {
        return statSync(lockFile).mtimeMs < Date.now() - staleMs || ownerHasExited(lockFile);
    } catch {
        // Gone between the failed create and this stat: free, so retry.
        return false;
    }
}

/**
 * A `finally` does not run when a signal kills the process, so Ctrl-C during the
 * guarded work leaves the lock behind. The owner string starts with its pid, and
 * a pid with no process breaks the lock at once rather than after `staleMs`.
 * A pid this process cannot signal (`EPERM`) belongs to a live process.
 */
function ownerHasExited(lockFile: string): boolean {
    let pid: number;
    try {
        pid = Number.parseInt(readFileSync(lockFile, 'utf-8').split('-')[0], 10);
    } catch {
        return false;
    }
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return errorCode(error) === 'ESRCH';
    }
}

function removeLock(lockFile: string): void {
    try {
        unlinkSync(lockFile);
    } catch {
        // Another process already removed it.
    }
}

export function errorCode(error: unknown): string | undefined {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        return error.code;
    }
    return undefined;
}
