import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function getWorktreeRoot(cwd = process.cwd()) {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
    }).trim();
}

export function getDevStatusPath(cwd = process.cwd()) {
    return path.join(getWorktreeRoot(cwd), '.vendure', 'dev-server.json');
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

export function readDevStatus(statusPath) {
    try {
        return JSON.parse(readFileSync(statusPath, 'utf8'));
    } catch {
        return undefined;
    }
}

export function removeDevStatus(statusPath) {
    rmSync(statusPath, { force: true });
}

function writeDevStatus(statusPath, status) {
    const temporaryPath = `${statusPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(status, null, 2)}\n`);
    renameSync(temporaryPath, statusPath);
}

export function claimDevStatus({
    cwd = process.cwd(),
    statusPath = getDevStatusPath(cwd),
    pid = process.pid,
    worktreePath = getWorktreeRoot(cwd),
    processIsAlive = isProcessAlive,
    initialStatus,
} = {}) {
    mkdirSync(path.dirname(statusPath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt++) {
        let fileDescriptor;
        try {
            fileDescriptor = openSync(statusPath, 'wx');
            const status = {
                version: 1,
                pid,
                worktreePath,
                startedAt: new Date().toISOString(),
                ...initialStatus,
            };
            writeFileSync(fileDescriptor, `${JSON.stringify(status, null, 2)}\n`);
            closeSync(fileDescriptor);

            return {
                statusPath,
                get status() {
                    return status;
                },
                update(changes) {
                    Object.assign(status, changes);
                    writeDevStatus(statusPath, status);
                    return status;
                },
                remove() {
                    const currentStatus = readDevStatus(statusPath);
                    if (currentStatus?.pid === pid) {
                        removeDevStatus(statusPath);
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

            const existingStatus = readDevStatus(statusPath);
            if (existingStatus && processIsAlive(existingStatus.pid)) {
                throw new Error(
                    `An agent dev server is already running for this worktree (PID ${existingStatus.pid}).\n` +
                        `Status: ${statusPath}`,
                );
            }
            removeDevStatus(statusPath);
        }
    }

    throw new Error(`Could not claim the agent dev status file at ${statusPath}`);
}

export function getActiveDevStatus({
    cwd = process.cwd(),
    statusPath = getDevStatusPath(cwd),
    processIsAlive = isProcessAlive,
} = {}) {
    const status = readDevStatus(statusPath);
    if (!status) {
        return undefined;
    }
    if (!processIsAlive(status.pid)) {
        removeDevStatus(statusPath);
        return undefined;
    }
    return status;
}
