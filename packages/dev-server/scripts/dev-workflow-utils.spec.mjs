import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
    createWatcherBuildDetector,
    createWatcherReadiness,
    resolvePackageBin,
    RestartableProcess,
    RestartReadinessCoordinator,
} from './dev-workflow-utils.mjs';

test('moves lifecycle away from ready until every restarted process is ready again', async () => {
    const updates = [];
    const coordinator = new RestartReadinessCoordinator({
        updateStatus: update => updates.push(update),
        now: () => 'ready-again',
    });
    const serverToken = coordinator.begin('server');
    const dashboardToken = coordinator.begin('dashboard');

    await coordinator.complete('server', serverToken, async () => undefined);
    assert.equal(updates.at(-1).status, 'starting');

    await coordinator.complete('dashboard', dashboardToken, async () => undefined);
    assert.deepEqual(updates.at(-1), { status: 'ready', readyAt: 'ready-again' });
});

test('ignores readiness from an obsolete restart of the same process', async () => {
    const updates = [];
    const coordinator = new RestartReadinessCoordinator({
        updateStatus: update => updates.push(update),
    });
    const obsoleteToken = coordinator.begin('server');
    const currentToken = coordinator.begin('server');

    assert.equal(await coordinator.complete('server', obsoleteToken, async () => undefined), false);
    assert.equal(updates.at(-1).status, 'starting');
    assert.equal(await coordinator.complete('server', currentToken, async () => undefined), true);
    assert.equal(updates.at(-1).status, 'ready');
});

test('restartable process reports restarting before replacing its child', async () => {
    const events = [];
    let closeChild;
    const process = new RestartableProcess({
        label: 'server',
        restartDebounceMs: 0,
        spawnProcess: onClose => {
            closeChild = onClose;
            return {
                exitCode: null,
                signalCode: null,
                kill(signal) {
                    events.push(`kill:${signal}`);
                },
            };
        },
        onUnexpectedExit: () => events.push('unexpected-exit'),
        onRestarting: () => {
            events.push('starting');
            return 42;
        },
        onRestarted: (_label, token) => events.push(`ready:${token}`),
    });

    process.start();
    process.restart();
    await new Promise(resolve => setTimeout(resolve, 10));
    closeChild(0, 'SIGTERM');
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, ['starting', 'kill:SIGTERM', 'ready:42']);
});

test('watcher build detector separates initial readiness from rebuilds', () => {
    const events = [];
    const handleLine = createWatcherBuildDetector({
        onInitialBuild: () => events.push('initial'),
        onSuccessfulRebuild: () => events.push('rebuild'),
    });

    handleLine('Starting compilation in watch mode...');
    handleLine('Found 0 errors. Watching for file changes.');
    handleLine('Found 0 errors. Watching for file changes.');

    assert.deepEqual(events, ['initial', 'rebuild']);
});

test('watcher readiness fails clearly when the success signal never arrives', async () => {
    let triggerTimeout;
    const readiness = createWatcherReadiness({
        label: 'core',
        onSuccessfulRebuild: () => undefined,
        timeoutMs: 10_000,
        scheduleTimeout: callback => {
            triggerTimeout = callback;
            return 123;
        },
        cancelTimeout: () => undefined,
    });

    triggerTimeout();

    await assert.rejects(readiness.ready, /core did not report.*10 seconds/);
});

test('resolves a package executable from its declared bin metadata', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-package-bin-'));
    try {
        const packageDir = path.join(dir, 'node_modules', 'example-package');
        const entryPath = path.join(packageDir, 'dist', 'index.js');
        mkdirSync(path.dirname(entryPath), { recursive: true });
        writeFileSync(entryPath, '');
        writeFileSync(
            path.join(packageDir, 'package.json'),
            JSON.stringify({
                name: 'example-package',
                main: './dist/index.js',
                bin: { example: './commands/example.js' },
            }),
        );

        assert.equal(
            resolvePackageBin(pathToFileURL(entryPath).href, 'example-package', 'example'),
            path.join(packageDir, 'commands', 'example.js'),
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
