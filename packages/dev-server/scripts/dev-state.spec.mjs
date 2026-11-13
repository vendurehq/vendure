import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { claimDevStatus, getActiveDevStatus, readDevStatus } from './dev-state.mjs';

function withTempDir(run) {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-dev-state-'));
    try {
        run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('claims, updates, and removes an agent dev status file', () => {
    withTempDir(dir => {
        const statusPath = path.join(dir, '.vendure', 'dev-server.json');
        const lifecycle = claimDevStatus({
            cwd: dir,
            statusPath,
            pid: 123,
            worktreePath: dir,
            initialStatus: { status: 'building' },
        });

        lifecycle.update({ status: 'ready', readyAt: 'now' });
        assert.equal(readDevStatus(statusPath)?.status, 'ready');
        lifecycle.remove();
        assert.equal(readDevStatus(statusPath), undefined);
    });
});

test('reports an active agent dev server', () => {
    withTempDir(dir => {
        const statusPath = path.join(dir, 'dev-server.json');
        writeFileSync(
            statusPath,
            JSON.stringify({
                pid: 456,
                worktreePath: dir,
                status: 'ready',
            }),
        );

        assert.throws(
            () =>
                claimDevStatus({
                    cwd: dir,
                    statusPath,
                    pid: 123,
                    worktreePath: dir,
                    processIsAlive: pid => pid === 456,
                }),
            /already running.*PID 456/s,
        );
    });
});

test('reclaims stale agent dev state', () => {
    withTempDir(dir => {
        const statusPath = path.join(dir, 'dev-server.json');
        writeFileSync(statusPath, JSON.stringify({ pid: 456, status: 'ready' }));

        const lifecycle = claimDevStatus({
            cwd: dir,
            statusPath,
            pid: 123,
            worktreePath: dir,
            processIsAlive: () => false,
            initialStatus: { status: 'building' },
        });

        assert.equal(readDevStatus(statusPath)?.pid, 123);
        lifecycle.remove();
    });
});

test('removes stale state when checking status', () => {
    withTempDir(dir => {
        const statusPath = path.join(dir, 'dev-server.json');
        writeFileSync(statusPath, JSON.stringify({ pid: 456, status: 'ready' }));

        assert.equal(
            getActiveDevStatus({
                cwd: dir,
                statusPath,
                processIsAlive: () => false,
            }),
            undefined,
        );
        assert.equal(readDevStatus(statusPath), undefined);
    });
});

test('does not delete a status file that is still being initialized', () => {
    withTempDir(dir => {
        const statusPath = path.join(dir, 'dev-server.json');
        writeFileSync(statusPath, '');

        assert.throws(
            () =>
                claimDevStatus({
                    cwd: dir,
                    statusPath,
                    pid: 123,
                    worktreePath: dir,
                    processIsAlive: () => false,
                }),
            /currently being initialized/,
        );
        assert.equal(readDevStatus(statusPath), undefined);
    });
});
