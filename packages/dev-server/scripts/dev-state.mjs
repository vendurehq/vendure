import { execFileSync } from 'node:child_process';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { claimExclusiveLock, isProcessAlive, readJsonFile } from './exclusive-lock.mjs';

export function getWorktreeRoot(cwd = process.cwd()) {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
    }).trim();
}

export function getDevStatusPath(cwd = process.cwd()) {
    return path.join(getWorktreeRoot(cwd), '.vendure', 'dev-server.json');
}

export function readDevStatus(statusPath) {
    return readJsonFile(statusPath);
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
    const status = {
        version: 1,
        pid,
        worktreePath,
        startedAt: new Date().toISOString(),
        ...initialStatus,
    };
    const claim = claimExclusiveLock({
        filePath: statusPath,
        value: status,
        processIsAlive,
        getActiveError: existingStatus =>
            new Error(
                `An agent dev server is already running for this worktree (PID ${existingStatus.pid}).\n` +
                    `Status: ${statusPath}`,
            ),
        getInitializingError: () =>
            new Error(`The agent dev status file is currently being initialized.\nStatus: ${statusPath}`),
        getClaimError: () => new Error(`Could not claim the agent dev status file at ${statusPath}`),
    });

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
        remove: () => claim.release(),
    };
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

export { isProcessAlive };
