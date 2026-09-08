import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    discoverDashboardExtensionDirectories,
    getDevProcessDefinitions,
    ManagedDevProcess,
    normalizeDevTarget,
    resolveVendureProjectDirectory,
    shouldRestartOnFileChange,
    startSupervisedDevProcess,
    waitForDevProcesses,
} from './dev';

function createTempDir() {
    return mkdtempSync(path.join(tmpdir(), 'vendure-cli-dev-'));
}

function writePackageJson(dir: string, packageJson: Record<string, any>) {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
}

// Stands in for a spawned child process, so that a test can decide exactly how and when it exits.
class FakeChildProcess extends EventEmitter {
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;

    kill(signal: NodeJS.Signals): boolean {
        this.close(null, signal);
        return true;
    }

    close(code: number | null, signal: NodeJS.Signals | null) {
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('close', code, signal);
    }
}

describe('dev command', () => {
    describe('getDevProcessDefinitions()', () => {
        it('uses default entrypoints', () => {
            const definitions = getDevProcessDefinitions();

            expect(definitions.server.nodeArgs).toEqual([]);
            expect(definitions.server.args).toEqual(['./src/index.ts']);
            expect(definitions.server.reloadOnChange).toBe(true);
            expect(definitions.worker.nodeArgs).toEqual([]);
            expect(definitions.worker.args).toEqual(['./src/index-worker.ts']);
            expect(definitions.worker.reloadOnChange).toBe(true);
            expect(definitions.dashboard.args).toEqual(['--clearScreen', 'false']);
            expect(definitions.dashboard.reloadOnChange).toBe(false);
        });

        it('uses custom entrypoints', () => {
            const definitions = getDevProcessDefinitions({
                serverEntry: './server.ts',
                workerEntry: './worker.ts',
                viteConfig: './config/vite.dashboard.mts',
            });

            expect(definitions.server.args).toEqual(['./server.ts']);
            expect(definitions.worker.args).toEqual(['./worker.ts']);
            expect(definitions.dashboard.args).toEqual([
                '--clearScreen',
                'false',
                '--config',
                './config/vite.dashboard.mts',
            ]);
        });

        it('adds inspector flags to a single dev target', () => {
            const definitions = getDevProcessDefinitions(
                {
                    inspect: '127.0.0.1:9230',
                },
                'server',
            );

            expect(definitions.server.nodeArgs).toEqual(['--inspect=127.0.0.1:9230']);
            expect(definitions.worker.nodeArgs).toEqual(['--inspect=127.0.0.1:9230']);
        });

        it('assigns adjacent inspector ports for dev all', () => {
            const definitions = getDevProcessDefinitions(
                {
                    inspect: true,
                },
                'all',
            );

            expect(definitions.server.nodeArgs).toEqual(['--inspect=9229']);
            expect(definitions.worker.nodeArgs).toEqual(['--inspect=9230']);
        });

        it('increments a custom inspector port for the worker in dev all', () => {
            const definitions = getDevProcessDefinitions(
                {
                    inspectBrk: '127.0.0.1:9330',
                },
                'all',
            );

            expect(definitions.server.nodeArgs).toEqual(['--inspect-brk=127.0.0.1:9330']);
            expect(definitions.worker.nodeArgs).toEqual(['--inspect-brk=127.0.0.1:9331']);
        });

        it('rejects inspect for the dashboard target', () => {
            expect(() =>
                getDevProcessDefinitions(
                    {
                        inspect: true,
                    },
                    'dashboard',
                ),
            ).toThrow('--inspect can only be used');
        });
    });

    describe('normalizeDevTarget()', () => {
        it('defaults to all', () => {
            expect(normalizeDevTarget()).toBe('all');
        });

        it('accepts known targets', () => {
            expect(normalizeDevTarget('all')).toBe('all');
            expect(normalizeDevTarget('server')).toBe('server');
            expect(normalizeDevTarget('worker')).toBe('worker');
            expect(normalizeDevTarget('dashboard')).toBe('dashboard');
        });

        it('rejects unknown targets', () => {
            expect(() => normalizeDevTarget('api')).toThrow('Unknown dev target');
        });
    });

    describe('resolveVendureProjectDirectory()', () => {
        it('returns the current directory for a Vendure package', () => {
            const dir = createTempDir();
            try {
                writePackageJson(dir, {
                    dependencies: {
                        '@vendure/core': '3.6.0',
                    },
                });

                expect(resolveVendureProjectDirectory(dir)).toBe(dir);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('finds a Vendure package in a monorepo root', () => {
            const dir = createTempDir();
            const serverDir = path.join(dir, 'apps', 'server');
            try {
                mkdirSync(serverDir, { recursive: true });
                writePackageJson(dir, {
                    private: true,
                    workspaces: ['apps/*'],
                });
                writePackageJson(serverDir, {
                    dependencies: {
                        '@vendure/core': '3.6.0',
                    },
                });

                expect(resolveVendureProjectDirectory(dir)).toBe(serverDir);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('finds a Vendure package in a monorepo root when @vendure/core is a devDependency', () => {
            const dir = createTempDir();
            const serverDir = path.join(dir, 'apps', 'server');
            try {
                mkdirSync(serverDir, { recursive: true });
                writePackageJson(dir, {
                    private: true,
                    workspaces: ['apps/*'],
                });
                writePackageJson(serverDir, {
                    devDependencies: {
                        '@vendure/core': '3.6.0',
                    },
                });

                expect(resolveVendureProjectDirectory(dir)).toBe(serverDir);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('reload file filtering', () => {
        it('does not restart server or worker processes for Dashboard extension files declared in plugin metadata', () => {
            const projectDir = path.resolve('/project');
            const dashboardDir = path.join(projectDir, 'src', 'plugins', 'reviews', 'dashboard');

            expect(
                shouldRestartOnFileChange(path.join(dashboardDir, 'index.tsx'), projectDir, {
                    dashboardExtensionDirectories: [dashboardDir],
                }),
            ).toBe(false);
            expect(
                shouldRestartOnFileChange(path.join(dashboardDir, 'components', 'rating.ts'), projectDir, {
                    dashboardExtensionDirectories: [dashboardDir],
                }),
            ).toBe(false);
        });

        it('does not restart server or worker processes for discovered Dashboard extension directories', () => {
            const projectDir = path.resolve('/project');
            const dashboardDir = path.join(projectDir, 'src', 'plugins', 'reviews', 'ui');

            expect(
                shouldRestartOnFileChange(path.join(dashboardDir, 'components', 'rating.ts'), projectDir, {
                    dashboardExtensionDirectories: [dashboardDir],
                }),
            ).toBe(false);
        });

        it('restarts server or worker processes for backend source files', () => {
            const projectDir = path.resolve('/project');

            expect(
                shouldRestartOnFileChange(
                    path.join(projectDir, 'src', 'plugins', 'reviews', 'reviews.plugin.ts'),
                    projectDir,
                ),
            ).toBe(true);
        });

        it('does not restart server or worker processes for generated type declaration files', () => {
            const projectDir = path.resolve('/project');

            expect(
                shouldRestartOnFileChange(
                    path.join(projectDir, 'src', 'graphql', 'graphql-env.d.ts'),
                    projectDir,
                ),
            ).toBe(false);
            expect(
                shouldRestartOnFileChange(path.join(projectDir, 'src', 'types', 'schema.d.cts'), projectDir),
            ).toBe(false);
            expect(
                shouldRestartOnFileChange(path.join(projectDir, 'src', 'types', 'schema.d.mts'), projectDir),
            ).toBe(false);
        });

        it('does not restart server or worker processes for Vite config changes', () => {
            const projectDir = path.resolve('/project');

            expect(shouldRestartOnFileChange(path.join(projectDir, 'vite.config.mts'), projectDir)).toBe(
                false,
            );
        });

        it('does not restart server or worker processes for paths a caller declares as generated', () => {
            const projectDir = path.resolve('/project');
            const generatedDir = path.join(projectDir, 'src', 'gql');

            expect(
                shouldRestartOnFileChange(path.join(generatedDir, 'graphql.ts'), projectDir, {
                    reloadIgnoredPaths: [generatedDir],
                }),
            ).toBe(false);
            expect(
                shouldRestartOnFileChange(path.join(projectDir, 'src', 'vendure-config.ts'), projectDir, {
                    reloadIgnoredPaths: [generatedDir],
                }),
            ).toBe(true);
        });

        it('restarts server or worker processes for TypeScript source files and env changes only', () => {
            const projectDir = path.resolve('/project');

            expect(
                shouldRestartOnFileChange(path.join(projectDir, 'src', 'vendure-config.js'), projectDir),
            ).toBe(false);
            expect(shouldRestartOnFileChange(path.join(projectDir, '.env'), projectDir)).toBe(true);
            expect(shouldRestartOnFileChange(path.join(projectDir, '.env.local'), projectDir)).toBe(true);
            expect(shouldRestartOnFileChange(path.join(projectDir, 'package.json'), projectDir)).toBe(false);
        });

        it('discovers Dashboard extension directories from plugin metadata', () => {
            const dir = createTempDir();
            const pluginDir = path.join(dir, 'src', 'plugins', 'reviews');
            try {
                mkdirSync(pluginDir, { recursive: true });
                writeFileSync(
                    path.join(pluginDir, 'reviews.plugin.ts'),
                    `
                    import { VendurePlugin } from '@vendure/core';

                    @VendurePlugin({
                        dashboard: { location: './ui/index.tsx' },
                    })
                    export class ReviewsPlugin {}
                `,
                );

                expect(discoverDashboardExtensionDirectories(dir)).toEqual([path.join(pluginDir, 'ui')]);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('discovers conventional Dashboard extension directories from plugin metadata', () => {
            const dir = createTempDir();
            const pluginDir = path.join(dir, 'src', 'plugins', 'reviews');
            try {
                mkdirSync(pluginDir, { recursive: true });
                writeFileSync(
                    path.join(pluginDir, 'reviews.plugin.ts'),
                    `
                    import { VendurePlugin } from '@vendure/core';

                    @VendurePlugin({
                        dashboard: './dashboard/index.tsx',
                    })
                    export class ReviewsPlugin {}
                `,
                );

                expect(discoverDashboardExtensionDirectories(dir)).toEqual([
                    path.join(pluginDir, 'dashboard'),
                ]);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('startSupervisedDevProcess()', () => {
        const startedProcesses: ManagedDevProcess[] = [];
        const temporaryDirectories: string[] = [];

        afterEach(() => {
            for (const startedProcess of startedProcesses) {
                startedProcess.stop('SIGTERM');
            }
            startedProcesses.length = 0;
            for (const directory of temporaryDirectories) {
                rmSync(directory, { recursive: true, force: true });
            }
            temporaryDirectories.length = 0;
        });

        function startSupervisor() {
            const projectDir = createTempDir();
            temporaryDirectories.push(projectDir);
            mkdirSync(path.join(projectDir, 'src'), { recursive: true });
            const children: FakeChildProcess[] = [];
            const spawnChild = vi.fn(() => {
                const child = new FakeChildProcess();
                children.push(child);
                return child as unknown as ChildProcess;
            });
            const supervised = startSupervisedDevProcess(
                projectDir,
                getDevProcessDefinitions().server,
                path.join(projectDir, 'node_modules', '.bin', 'ts-node'),
                { prefixOutput: false, reloadIgnoredPaths: [], spawnChild },
            );
            startedProcesses.push(supervised);
            return { children, projectDir, spawnChild, supervised };
        }

        it('leaves the other dev processes running when a supervised child crashes', async () => {
            const { children, supervised } = startSupervisor();
            const stopDashboard = vi.fn();
            const dashboard = new ManagedDevProcess(stopDashboard);
            const promise = waitForDevProcesses([supervised, dashboard]);

            children[0].close(1, null);

            expect(supervised.hasClosed).toBe(false);
            expect(stopDashboard).not.toHaveBeenCalled();

            process.emit('SIGINT');
            dashboard.emitClose(null, 'SIGINT');
            await expect(promise).resolves.toBe(130);
        });

        it('respawns a crashed supervised child on the next relevant file change', async () => {
            const { children, projectDir, spawnChild, supervised } = startSupervisor();
            const promise = waitForDevProcesses([supervised]);

            children[0].close(1, null);
            expect(spawnChild).toHaveBeenCalledTimes(1);

            writeFileSync(path.join(projectDir, 'src', 'vendure-config.ts'), 'export const config = {};');

            await vi.waitFor(() => expect(spawnChild).toHaveBeenCalledTimes(2), {
                timeout: 10000,
                interval: 25,
            });
            expect(supervised.hasClosed).toBe(false);

            process.emit('SIGINT');
            await expect(promise).resolves.toBe(130);
        });

        it('reports the crash exit code when something else ends the run', async () => {
            const { children, supervised } = startSupervisor();
            const dashboard = new ManagedDevProcess(vi.fn());
            const promise = waitForDevProcesses([supervised, dashboard]);

            children[0].close(1, null);
            // The Dashboard then exits cleanly on its own, which ends the run while the server is
            // still sitting dead. The run must not claim success.
            dashboard.emitClose(0, null);

            await expect(promise).resolves.toBe(1);
        });

        it('ends the whole run when a supervised child is killed by a signal', async () => {
            const { children, supervised } = startSupervisor();
            const stopDashboard = vi.fn();
            const dashboard = new ManagedDevProcess(stopDashboard);
            const promise = waitForDevProcesses([supervised, dashboard]);

            children[0].close(null, 'SIGKILL');

            expect(supervised.hasClosed).toBe(true);
            expect(stopDashboard).toHaveBeenCalledWith('SIGTERM');

            dashboard.emitClose(null, 'SIGTERM');
            await expect(promise).resolves.toBe(1);
        });

        it('ends the whole run when a child closes with neither an exit code nor a signal', async () => {
            const { children, supervised } = startSupervisor();
            const promise = waitForDevProcesses([supervised]);

            children[0].close(null, null);

            expect(supervised.hasClosed).toBe(true);
            await expect(promise).resolves.toBe(1);
        });
    });

    describe('waitForDevProcesses()', () => {
        it('resolves SIGINT shutdowns with the canonical signal exit code', async () => {
            const stopFirst = vi.fn();
            const stopSecond = vi.fn();
            const firstChild = new ManagedDevProcess(stopFirst);
            const secondChild = new ManagedDevProcess(stopSecond);
            const sigintListenerCount = process.listenerCount('SIGINT');
            const sigtermListenerCount = process.listenerCount('SIGTERM');
            const promise = waitForDevProcesses([firstChild, secondChild]);

            process.emit('SIGINT');

            expect(stopFirst).toHaveBeenCalledWith('SIGINT');
            expect(stopSecond).toHaveBeenCalledWith('SIGINT');
            firstChild.emitClose(null, 'SIGINT');
            secondChild.emitClose(0, null);
            await expect(promise).resolves.toBe(130);
            expect(process.listenerCount('SIGINT')).toBe(sigintListenerCount);
            expect(process.listenerCount('SIGTERM')).toBe(sigtermListenerCount);
        });

        it('resolves SIGTERM shutdowns with the canonical signal exit code', async () => {
            const firstChild = new ManagedDevProcess(vi.fn());
            const secondChild = new ManagedDevProcess(vi.fn());
            const promise = waitForDevProcesses([firstChild, secondChild]);

            process.emit('SIGTERM');

            firstChild.emitClose(0, null);
            secondChild.emitClose(null, 'SIGTERM');
            await expect(promise).resolves.toBe(143);
        });
    });
});
