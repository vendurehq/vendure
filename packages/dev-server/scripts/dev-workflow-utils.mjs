import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESTART_DEBOUNCE_MS = 200;
export const WATCHER_READINESS_TIMEOUT_MS = 120_000;

export function resolvePackageBin(packageEntryUrl, packageName, binName) {
    let currentDirectory = path.dirname(fileURLToPath(packageEntryUrl));

    while (true) {
        const packageJsonPath = path.join(currentDirectory, 'package.json');
        if (existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
            if (packageJson.name === packageName) {
                const binPath =
                    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];
                if (!binPath) {
                    throw new Error(`Package ${packageName} does not declare a "${binName}" executable`);
                }
                return path.resolve(currentDirectory, binPath);
            }
        }

        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            throw new Error(`Could not find package metadata for ${packageName}`);
        }
        currentDirectory = parentDirectory;
    }
}

export class RestartReadinessCoordinator {
    constructor({ updateStatus, now = () => new Date().toISOString() }) {
        this.updateStatus = updateStatus;
        this.now = now;
        this.pending = new Map();
        this.sequence = 0;
    }

    begin(label) {
        const token = ++this.sequence;
        this.pending.set(label, token);
        this.updateStatus({
            status: 'starting',
            readyAt: undefined,
        });
        return token;
    }

    async complete(label, token, waitUntilReady) {
        await waitUntilReady();
        if (this.pending.get(label) !== token) {
            return false;
        }

        this.pending.delete(label);
        if (this.pending.size === 0) {
            this.updateStatus({
                status: 'ready',
                readyAt: this.now(),
            });
        }
        return true;
    }
}

export class RestartableProcess {
    constructor({
        label,
        spawnProcess,
        onUnexpectedExit,
        shouldRestart = () => true,
        onRestarting = () => undefined,
        onRestarted = () => undefined,
        onRestartFailure = error => {
            throw error;
        },
        restartDebounceMs = RESTART_DEBOUNCE_MS,
    }) {
        this.label = label;
        this.spawnProcess = spawnProcess;
        this.onUnexpectedExit = onUnexpectedExit;
        this.shouldRestart = shouldRestart;
        this.onRestarting = onRestarting;
        this.onRestarted = onRestarted;
        this.onRestartFailure = onRestartFailure;
        this.restartDebounceMs = restartDebounceMs;
    }

    start({ restartToken } = {}) {
        this.child = this.spawnProcess((code, signal) => {
            if (this.restarting) {
                this.restarting = false;
                this.start({ restartToken: this.restartToken });
            } else {
                this.onUnexpectedExit(this.label, code, signal);
            }
        });

        if (restartToken !== undefined) {
            Promise.resolve(this.onRestarted(this.label, restartToken)).catch(this.onRestartFailure);
        }
    }

    restart() {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            if (!this.shouldRestart()) {
                return;
            }
            const restartToken = this.onRestarting(this.label);
            this.restartToken = restartToken;
            if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
                this.start({ restartToken });
                return;
            }
            this.restarting = true;
            this.child.kill('SIGTERM');
        }, this.restartDebounceMs);
    }

    stop(signal = 'SIGTERM') {
        clearTimeout(this.restartTimer);
        this.restarting = false;
        if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
            this.child.kill(signal);
        }
    }
}

export function createWatcherBuildDetector({ onInitialBuild, onSuccessfulRebuild }) {
    let successfulBuildCount = 0;

    return line => {
        if (!line.includes('Found 0 errors. Watching for file changes.')) {
            return;
        }
        successfulBuildCount++;
        if (successfulBuildCount === 1) {
            onInitialBuild();
        } else {
            onSuccessfulRebuild();
        }
    };
}

export function createWatcherReadiness({
    label,
    onSuccessfulRebuild,
    timeoutMs = WATCHER_READINESS_TIMEOUT_MS,
    scheduleTimeout = setTimeout,
    cancelTimeout = clearTimeout,
}) {
    let ready = false;
    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const readinessTimer = scheduleTimeout(() => {
        rejectReady(
            new Error(
                `${label} did not report a successful TypeScript watch build within ${
                    timeoutMs / 1000
                } seconds`,
            ),
        );
    }, timeoutMs);
    const handleLine = createWatcherBuildDetector({
        onInitialBuild() {
            ready = true;
            cancelTimeout(readinessTimer);
            resolveReady();
        },
        onSuccessfulRebuild,
    });

    return {
        ready: readyPromise,
        handleLine,
        fail(error) {
            cancelTimeout(readinessTimer);
            if (!ready) {
                rejectReady(error);
            }
        },
        get isReady() {
            return ready;
        },
    };
}
