import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LOCK_INITIALIZATION_GRACE_MS = 2_000;

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

export function readJsonFile(filePath) {
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
        return undefined;
    }
}

export function claimExclusiveLock({
    filePath,
    value,
    processIsAlive = isProcessAlive,
    getOwnerPid = currentValue => currentValue?.pid,
    getActiveError,
    getInitializingError,
    getClaimError,
    now = Date.now,
    getModifiedAt = currentPath => statSync(currentPath, { throwIfNoEntry: false })?.mtimeMs ?? 0,
}) {
    mkdirSync(path.dirname(filePath), { recursive: true });

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

            return {
                release() {
                    const currentValue = readJsonFile(filePath);
                    if (getOwnerPid(currentValue) === getOwnerPid(value)) {
                        rmSync(filePath, { force: true });
                    }
                },
            };
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            const existingValue = readJsonFile(filePath);
            if (existingValue && processIsAlive(getOwnerPid(existingValue))) {
                throw getActiveError(existingValue);
            }
            if (!existingValue && now() - getModifiedAt(filePath) < LOCK_INITIALIZATION_GRACE_MS) {
                throw getInitializingError();
            }
            rmSync(filePath, { force: true });
        }
    }

    throw getClaimError();
}
