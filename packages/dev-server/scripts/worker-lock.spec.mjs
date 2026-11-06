import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { acquireWorkerLock, readWorkerLock } from './worker-lock.mjs';

function withTempDir(run) {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-worker-lock-'));
    try {
        run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

test('acquires and releases a worker lock', () => {
    withTempDir(dir => {
        const lockPath = path.join(dir, '.vendure', 'worker.lock');
        const lock = acquireWorkerLock({ cwd: dir, lockPath, pid: 123 });

        assert.deepEqual(readWorkerLock(lockPath), lock.metadata);
        lock.release();
        assert.equal(readWorkerLock(lockPath), undefined);
    });
});

test('reports the active worker owner', () => {
    withTempDir(dir => {
        const lockPath = path.join(dir, 'worker.lock');
        writeFileSync(
            lockPath,
            JSON.stringify({
                pid: 456,
                worktreePath: '/tmp/other-worktree',
                startedAt: new Date().toISOString(),
            }),
        );

        assert.throws(
            () =>
                acquireWorkerLock({
                    cwd: dir,
                    lockPath,
                    pid: 123,
                    processIsAlive: pid => pid === 456,
                }),
            /other-worktree.*PID 456/s,
        );
    });
});

test('automatically reclaims a stale worker lock', () => {
    withTempDir(dir => {
        const lockPath = path.join(dir, 'worker.lock');
        writeFileSync(
            lockPath,
            JSON.stringify({
                pid: 456,
                worktreePath: '/tmp/stale-worktree',
                startedAt: new Date().toISOString(),
            }),
        );

        const lock = acquireWorkerLock({
            cwd: dir,
            lockPath,
            pid: 123,
            processIsAlive: () => false,
        });

        assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, 123);
        lock.release();
    });
});

test('does not delete a worker lock that is still being initialized', () => {
    withTempDir(dir => {
        const lockPath = path.join(dir, 'worker.lock');
        writeFileSync(lockPath, '');

        assert.throws(
            () =>
                acquireWorkerLock({
                    cwd: dir,
                    lockPath,
                    pid: 123,
                    processIsAlive: () => false,
                }),
            /currently being initialized/,
        );
        assert.equal(readFileSync(lockPath, 'utf8'), '');
    });
});
