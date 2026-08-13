import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { waitForChildProcesses } from './cli-process-utils';

class FakeChildProcess extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    killed = false;
    kill = vi.fn((signal?: NodeJS.Signals | number) => {
        this.killed = true;
        if (typeof signal === 'string') {
            this.signalCode = signal;
        }
        return true;
    });

    close(code: number | null, signal: NodeJS.Signals | null = null) {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('close', code, signal);
    }

    fail(error: Error) {
        this.emit('error', error);
    }
}

function fakeChild() {
    return new FakeChildProcess() as unknown as ChildProcess & FakeChildProcess;
}

describe('cli process utils', () => {
    describe('waitForChildProcesses()', () => {
        it('waits for sibling processes to close after one process exits', async () => {
            const children: ChildProcess[] = [];
            const exitingChild = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 20);'], {
                stdio: 'ignore',
            });
            const gracefulChild = spawn(
                process.execPath,
                [
                    '-e',
                    [
                        "process.on('SIGTERM', () => setTimeout(() => process.exit(0), 100));",
                        'setInterval(() => undefined, 1000);',
                    ].join('\n'),
                ],
                { stdio: 'ignore' },
            );
            children.push(exitingChild, gracefulChild);
            let gracefulChildClosed = false;
            gracefulChild.once('close', () => {
                gracefulChildClosed = true;
            });

            try {
                await expect(waitForChildProcesses(children)).resolves.toBe(0);
                expect(gracefulChildClosed).toBe(true);
            } finally {
                for (const child of children) {
                    if (child.exitCode === null && child.signalCode === null) {
                        child.kill('SIGKILL');
                    }
                }
            }
        });

        it('propagates the first non-zero exit code after sibling processes close', async () => {
            const failingChild = fakeChild();
            const siblingChild = fakeChild();
            const promise = waitForChildProcesses([failingChild, siblingChild]);

            failingChild.close(2);

            expect(siblingChild.kill).toHaveBeenCalledWith('SIGTERM');
            siblingChild.close(null, 'SIGTERM');
            await expect(promise).resolves.toBe(2);
        });

        it('reports child process errors and shuts down sibling processes', async () => {
            const errorChild = fakeChild();
            const siblingChild = fakeChild();
            const onError = vi.fn();
            const promise = waitForChildProcesses([errorChild, siblingChild], { onError });
            const error = new Error('spawn failed');

            errorChild.fail(error);

            expect(onError).toHaveBeenCalledWith(error);
            expect(siblingChild.kill).toHaveBeenCalledWith('SIGTERM');
            siblingChild.close(0);
            await expect(promise).resolves.toBe(1);
        });

        it('forwards SIGINT and cleans up process signal handlers', async () => {
            const firstChild = fakeChild();
            const secondChild = fakeChild();
            const sigintListenerCount = process.listenerCount('SIGINT');
            const sigtermListenerCount = process.listenerCount('SIGTERM');
            const promise = waitForChildProcesses([firstChild, secondChild]);

            process.emit('SIGINT');

            expect(firstChild.kill).toHaveBeenCalledWith('SIGINT');
            expect(secondChild.kill).toHaveBeenCalledWith('SIGINT');
            firstChild.close(null, 'SIGINT');
            secondChild.close(0);
            await expect(promise).resolves.toBe(130);
            expect(process.listenerCount('SIGINT')).toBe(sigintListenerCount);
            expect(process.listenerCount('SIGTERM')).toBe(sigtermListenerCount);
        });

        it('forwards SIGTERM and resolves with the canonical signal exit code', async () => {
            const firstChild = fakeChild();
            const secondChild = fakeChild();
            const promise = waitForChildProcesses([firstChild, secondChild]);

            process.emit('SIGTERM');

            expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM');
            expect(secondChild.kill).toHaveBeenCalledWith('SIGTERM');
            firstChild.close(0);
            secondChild.close(null, 'SIGTERM');
            await expect(promise).resolves.toBe(143);
        });

        it('ignores duplicate close events from the same child process', async () => {
            const firstChild = fakeChild();
            const secondChild = fakeChild();
            const promise = waitForChildProcesses([firstChild, secondChild]);
            let settled = false;
            void promise.then(() => {
                settled = true;
            });

            firstChild.close(0);
            firstChild.close(0);
            await Promise.resolve();

            expect(settled).toBe(false);
            secondChild.close(0);
            await expect(promise).resolves.toBe(0);
        });
    });
});
