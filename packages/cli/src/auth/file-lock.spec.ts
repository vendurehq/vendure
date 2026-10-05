import fs from 'fs-extra';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withFileLock } from './file-lock';

let directory: string;
let lockFile: string;

beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'vendure-lock-'));
    lockFile = path.join(directory, 'nested', 'auth.lock');
});

afterEach(() => {
    fs.removeSync(directory);
});

describe('withFileLock', () => {
    it('serializes holders and removes the lock afterwards', async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstMayFinish = new Promise<void>(resolve => (releaseFirst = resolve));
        const options = { staleMs: 10_000, waitMs: 10_000, pollMs: 5 };

        const first = withFileLock(lockFile, options, async held => {
            events.push(`first start ${String(held)}`);
            await firstMayFinish;
            events.push('first end');
        });
        const second = withFileLock(lockFile, options, async held => {
            events.push(`second start ${String(held)}`);
        });
        await new Promise(resolve => setTimeout(resolve, 30));
        releaseFirst();
        await Promise.all([first, second]);

        expect(events).toEqual(['first start true', 'first end', 'second start true']);
        expect(fs.existsSync(lockFile)).toBe(false);
    });

    it('breaks a stale lock', async () => {
        fs.mkdirpSync(path.dirname(lockFile));
        writeFileSync(lockFile, 'dead-process');
        const old = new Date(Date.now() - 60_000);
        utimesSync(lockFile, old, old);

        const held = await withFileLock(lockFile, { staleMs: 1_000, waitMs: 1_000 }, async h => h);

        expect(held).toBe(true);
    });

    it('breaks a fresh lock whose owner process has exited', async () => {
        const exited = spawnSync(process.execPath, ['-e', '']).pid;
        fs.mkdirpSync(path.dirname(lockFile));
        writeFileSync(lockFile, `${exited}-killed-mid-refresh`);

        const held = await withFileLock(lockFile, { staleMs: 60_000, waitMs: 20, pollMs: 5 }, async h => h);

        expect(held).toBe(true);
    });

    it('runs unlocked, and says so, when the wait runs out', async () => {
        fs.mkdirpSync(path.dirname(lockFile));
        writeFileSync(lockFile, 'live-process');

        const held = await withFileLock(lockFile, { staleMs: 60_000, waitMs: 20, pollMs: 5 }, async h => h);

        expect(held).toBe(false);
        // Not ours, so it is left in place.
        expect(fs.readFileSync(lockFile, 'utf-8')).toBe('live-process');
    });
});
