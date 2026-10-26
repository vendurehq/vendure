import { createHash, randomBytes } from 'node:crypto';
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
    const owner = newOwner();
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

        if (breakStaleLock(lockFile, options.staleMs)) {
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
    // Another process may have broken ours as stale and taken its own, so only
    // a lock that still names this owner is removed.
    removeIfUnchanged(lockFile, owner, () => true);
}

/** Removes the lock if it is stale. Returns whether it did. */
function breakStaleLock(lockFile: string, staleMs: number): boolean {
    const owner = readOwner(lockFile);
    if (owner === undefined || !isStale(lockFile, owner, staleMs)) {
        return false;
    }
    return removeIfUnchanged(lockFile, owner, () => isStale(lockFile, owner, staleMs));
}

/** A lock is stale when it has not been touched for `staleMs`, or when its owner has exited. */
function isStale(lockFile: string, owner: string, staleMs: number): boolean {
    try {
        return statSync(lockFile).mtimeMs < Date.now() - staleMs || ownerHasExited(owner);
    } catch {
        return false;
    }
}

/**
 * A `finally` does not run when a signal kills the process, so Ctrl-C during the
 * guarded work leaves the lock behind. The owner string starts with its pid, and
 * a pid with no process breaks the lock at once rather than after `staleMs`.
 * A pid this process cannot signal (`EPERM`) belongs to a live process.
 */
function ownerHasExited(owner: string): boolean {
    const pid = Number.parseInt(owner.split('-')[0], 10);
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

/**
 * Compare-and-remove: removes `file` only while it still contains `content`
 * and `shouldRemove()` is true. Returns whether it removed it.
 *
 * A file cannot be unlinked on a condition, so a check followed by an unlink
 * can remove a file that replaced the one checked. Two waiters that both find
 * the same stale lock would then both hold the lock. To prevent this, every
 * removal first creates `<file>.<digest of content>.claim` exclusively. Owner
 * strings are unique, so a claim names one version of the file, and only its
 * claimant removes that version. While the claim exists, nobody else can
 * remove that version, and nobody can create a new one because the file
 * still exists.
 *
 * A claim is never broken because of its age. A claimant that is paused but
 * alive can still unlink after a pause. A claim whose claimant has exited is
 * removed with this function, one level up.
 */
function removeIfUnchanged(file: string, content: string, shouldRemove: () => boolean): boolean {
    const claim = claimPath(file, content);
    const claimant = newOwner();
    while (true) {
        try {
            writeFileSync(claim, claimant, { flag: 'wx', mode: 0o600 });
            break;
        } catch (error) {
            if (errorCode(error) !== 'EEXIST' || !removeDeadClaim(claim)) {
                return false;
            }
        }
    }
    try {
        if (readOwner(file) !== content || !shouldRemove()) {
            return false;
        }
        unlinkQuietly(file);
        return true;
    } finally {
        // Nobody else removes the claim of a live claimant.
        unlinkQuietly(claim);
    }
}

function removeDeadClaim(claim: string): boolean {
    const claimant = readOwner(claim);
    return (
        claimant !== undefined &&
        ownerHasExited(claimant) &&
        removeIfUnchanged(claim, claimant, () => ownerHasExited(claimant))
    );
}

export function claimPath(file: string, content: string): string {
    return `${file}.${createHash('sha256').update(content).digest('hex').slice(0, 16)}.claim`;
}

function newOwner(): string {
    return `${process.pid}-${randomBytes(8).toString('hex')}`;
}

function readOwner(file: string): string | undefined {
    try {
        return readFileSync(file, 'utf-8');
    } catch {
        return undefined;
    }
}

function unlinkQuietly(file: string): void {
    try {
        unlinkSync(file);
    } catch {
        // Already removed.
    }
}

export function errorCode(error: unknown): string | undefined {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
        return error.code;
    }
    return undefined;
}
