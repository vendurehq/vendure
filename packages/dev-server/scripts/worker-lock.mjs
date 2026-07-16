import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

export function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

export function readWorkerLock(lockPath) {
    try {
        return JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
        return undefined;
    }
}

export function acquireWorkerLock({
    cwd = process.cwd(),
    lockPath = getWorkerLockPath(cwd),
    pid = process.pid,
    processIsAlive = isProcessAlive,
} = {}) {
    mkdirSync(path.dirname(lockPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt++) {
        let fileDescriptor;
        try {
            fileDescriptor = openSync(lockPath, 'wx');
            const metadata = {
                pid,
                worktreePath: path.resolve(cwd),
                startedAt: new Date().toISOString(),
            };
            writeFileSync(fileDescriptor, `${JSON.stringify(metadata, null, 2)}\n`);
            closeSync(fileDescriptor);

            return {
                lockPath,
                metadata,
                release() {
                    const currentLock = readWorkerLock(lockPath);
                    if (currentLock?.pid === pid) {
                        rmSync(lockPath, { force: true });
                    }
                },
            };
        } catch (error) {
            if (fileDescriptor !== undefined) {
                closeSync(fileDescriptor);
            }
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            const existingLock = readWorkerLock(lockPath);
            if (existingLock && processIsAlive(existingLock.pid)) {
                throw new Error(
                    `A Vendure worker is already running from ${existingLock.worktreePath} ` +
                        `(PID ${existingLock.pid}).\nLock: ${lockPath}`,
                );
            }
            rmSync(lockPath, { force: true });
        }
    }

    throw new Error(`Could not acquire the Vendure worker lock at ${lockPath}`);
}
