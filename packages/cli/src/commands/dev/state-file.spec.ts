import { LOCAL_TRUST_SECRET_ENV_VAR } from '@vendure/common/lib/local-trust';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    DevRunAlreadyRunningError,
    DevServerState,
    DevServerStateFile,
    getDevServerStateFilePath,
    isDevRunAlive,
    parseElapsedTime,
    readDevServerState,
    toStatusReport,
    withoutLocalTrustSecret,
} from './state-file.js';

const directories: string[] = [];

function createProjectDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-state-'));
    directories.push(dir);
    return dir;
}

function stateFor(pid = process.pid): Omit<DevServerState, 'secret'> {
    return {
        status: 'ready',
        urls: { admin: 'http://localhost:3000/admin-api' },
        startedAt: '2026-11-22T10:00:00.000Z',
        restarts: 0,
        lastError: null,
        pid,
    };
}

afterEach(() => {
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('DevServerStateFile', () => {
    it('writes .vendure/devserver.json with mode 0600 and the secret', () => {
        const projectDir = createProjectDir();
        new DevServerStateFile(projectDir, 'run-secret').write(stateFor());

        const filePath = getDevServerStateFilePath(projectDir);
        expect(filePath).toBe(path.join(projectDir, '.vendure', 'devserver.json'));
        expect(statSync(filePath).mode % 0o1000).toBe(0o600);
        expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ ...stateFor(), secret: 'run-secret' });
    });

    it('replaces the file on each write and leaves no temporary file', () => {
        const projectDir = createProjectDir();
        const stateFile = new DevServerStateFile(projectDir, 'run-secret');
        stateFile.write(stateFor());
        stateFile.write({ ...stateFor(), status: 'failed', restarts: 2 });

        expect(readDevServerState(projectDir)?.status).toBe('failed');
        expect(readDevServerState(projectDir)?.restarts).toBe(2);
        expect(readdirSync(path.join(projectDir, '.vendure'))).toEqual(['devserver.json']);
    });

    it('keeps the file mode 0600 when it replaces a file with a wider mode', () => {
        const projectDir = createProjectDir();
        const stateFile = new DevServerStateFile(projectDir, 'run-secret');
        stateFile.write(stateFor());
        writeFileSync(getDevServerStateFilePath(projectDir), '{}', { mode: 0o644 });
        stateFile.write(stateFor());

        expect(statSync(getDevServerStateFilePath(projectDir)).mode % 0o1000).toBe(0o600);
    });

    it('deletes the file on remove() while it holds this run’s secret', () => {
        const projectDir = createProjectDir();
        const stateFile = new DevServerStateFile(projectDir, 'run-secret');
        stateFile.write(stateFor());
        stateFile.remove();

        expect(readDevServerState(projectDir)).toBeUndefined();
        expect(() => stateFile.remove()).not.toThrow();
    });

    it('keeps the file on remove() once another run has written its own secret', () => {
        const projectDir = createProjectDir();
        const older = new DevServerStateFile(projectDir, 'older-secret');
        older.write(stateFor());
        new DevServerStateFile(projectDir, 'newer-secret').write(stateFor());
        older.remove();

        expect(readDevServerState(projectDir)?.secret).toBe('newer-secret');
    });
});

describe('DevServerStateFile.claim()', () => {
    // The parent of the test runner is a live process that is not this one, and it started
    // before now.
    const liveOther = () => ({ ...stateFor(process.ppid), startedAt: new Date().toISOString() });

    it('creates the state file when there is none', () => {
        const projectDir = createProjectDir();
        new DevServerStateFile(projectDir, 'run-secret').claim(stateFor());

        expect(readDevServerState(projectDir)?.secret).toBe('run-secret');
        expect(statSync(getDevServerStateFilePath(projectDir)).mode % 0o1000).toBe(0o600);
        expect(readdirSync(path.join(projectDir, '.vendure'))).toEqual(['devserver.json']);
    });

    it('refuses while another live run holds the file', () => {
        const projectDir = createProjectDir();
        new DevServerStateFile(projectDir, 'other-secret').write(liveOther());

        expect(() => new DevServerStateFile(projectDir, 'run-secret').claim(stateFor())).toThrow(
            DevRunAlreadyRunningError,
        );
        expect(readDevServerState(projectDir)?.secret).toBe('other-secret');
    });

    it('replaces a file left behind by a run that is gone', () => {
        const projectDir = createProjectDir();
        new DevServerStateFile(projectDir, 'old-secret').write(stateFor(2 ** 22 + 12345));
        new DevServerStateFile(projectDir, 'run-secret').claim(stateFor());

        expect(readDevServerState(projectDir)?.secret).toBe('run-secret');
    });

    it('lets only one of two runs claim the file', () => {
        const projectDir = createProjectDir();
        const first = new DevServerStateFile(projectDir, 'first-secret');
        const second = new DevServerStateFile(projectDir, 'second-secret');
        first.claim(liveOther());

        expect(() => second.claim(stateFor())).toThrow('already running');
    });
});

describe('isDevRunAlive()', () => {
    it('is true for this process', () => {
        expect(isDevRunAlive({ pid: process.pid, startedAt: '2000-01-01T00:00:00.000Z' })).toBe(true);
    });

    it('is false for a pid that no process has', () => {
        expect(isDevRunAlive({ pid: 2 ** 22 + 12345, startedAt: new Date().toISOString() })).toBe(false);
    });

    it('is false for a live process that started after the run did, as after pid reuse', () => {
        expect(isDevRunAlive({ pid: process.ppid, startedAt: '2000-01-01T00:00:00.000Z' })).toBe(
            process.platform === 'win32',
        );
        expect(isDevRunAlive({ pid: process.ppid, startedAt: new Date().toISOString() })).toBe(true);
    });
});

describe('parseElapsedTime()', () => {
    it('reads the forms that ps -o etime= prints', () => {
        expect(parseElapsedTime('  00:07\n')).toBe(7);
        expect(parseElapsedTime('12:34')).toBe(12 * 60 + 34);
        expect(parseElapsedTime('01:02:03')).toBe(3723);
        expect(parseElapsedTime('2-01:02:03')).toBe(2 * 86400 + 3723);
        expect(parseElapsedTime('')).toBeUndefined();
    });
});

describe('readDevServerState()', () => {
    it('returns undefined for a file that is not a state file', () => {
        const projectDir = createProjectDir();
        new DevServerStateFile(projectDir, 'run-secret').write(stateFor());
        writeFileSync(getDevServerStateFilePath(projectDir), '{"status":"ready"');

        expect(readDevServerState(projectDir)).toBeUndefined();
    });
});

describe('toStatusReport()', () => {
    it('leaves out the secret and the pid', () => {
        const report = toStatusReport({ ...stateFor(), secret: 'run-secret' });

        expect(report).toEqual({
            status: 'ready',
            urls: { admin: 'http://localhost:3000/admin-api' },
            startedAt: '2026-11-22T10:00:00.000Z',
            restarts: 0,
            lastError: null,
        });
        expect(JSON.stringify(report)).not.toContain('run-secret');
    });

    it('reports stopped when the process that wrote the file is gone', () => {
        // A pid this large is never a running process.
        expect(toStatusReport({ ...stateFor(2 ** 22 + 12345), secret: 's' }).status).toBe('stopped');
    });

    it('reports stopped with no start time when there is no state file', () => {
        expect(toStatusReport(undefined)).toEqual({
            status: 'stopped',
            urls: {},
            startedAt: null,
            restarts: 0,
            lastError: null,
        });
    });
});

describe('withoutLocalTrustSecret()', () => {
    it('removes the secret and keeps the rest of the environment', () => {
        const env = { PATH: '/usr/bin', [LOCAL_TRUST_SECRET_ENV_VAR]: 'from-the-shell' };

        expect(withoutLocalTrustSecret(env)).toEqual({ PATH: '/usr/bin' });
        expect(env[LOCAL_TRUST_SECRET_ENV_VAR]).toBe('from-the-shell');
    });
});
