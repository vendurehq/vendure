import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { claimExclusiveLock, isProcessAlive, readJsonFile } from './exclusive-lock.mjs';

export function getPrimaryRepositoryRoot(cwd = process.cwd()) {
    const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        encoding: 'utf8',
    }).trim();
    return path.dirname(path.resolve(cwd, gitCommonDir));
}

export function getWorkerLockPath(cwd = process.cwd()) {
    return path.join(getPrimaryRepositoryRoot(cwd), '.vendure', 'worker.lock');
}

export function readWorkerLock(lockPath) {
    return readJsonFile(lockPath);
}

export function acquireWorkerLock({
    cwd = process.cwd(),
    lockPath = getWorkerLockPath(cwd),
    pid = process.pid,
    processIsAlive = isProcessAlive,
} = {}) {
    const metadata = {
        pid,
        worktreePath: path.resolve(cwd),
        startedAt: new Date().toISOString(),
    };
    const claim = claimExclusiveLock({
        filePath: lockPath,
        value: metadata,
        processIsAlive,
        getActiveError: existingLock =>
            new Error(
                `A Vendure worker is already running from ${existingLock.worktreePath} ` +
                    `(PID ${existingLock.pid}).\nLock: ${lockPath}`,
            ),
        getInitializingError: () =>
            new Error(`The Vendure worker lock is currently being initialized.\nLock: ${lockPath}`),
        getClaimError: () => new Error(`Could not acquire the Vendure worker lock at ${lockPath}`),
    });

    return {
        lockPath,
        metadata,
        release: () => claim.release(),
    };
}
