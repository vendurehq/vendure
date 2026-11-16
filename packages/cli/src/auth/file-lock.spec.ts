import fs from 'fs-extra';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { claimPath, withFileLock } from './file-lock';

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

    it('does not break a claim whose claimant is alive, however old the claim is', async () => {
        const exited = spawnSync(process.execPath, ['-e', '']).pid;
        const deadOwner = `${exited}-killed-mid-refresh`;
        fs.mkdirpSync(path.dirname(lockFile));
        writeFileSync(lockFile, deadOwner);
        // A live process that is paused while it removes the dead lock.
        const claim = claimPath(lockFile, deadOwner);
        writeFileSync(claim, `${process.pid}-paused`);
        const old = new Date(Date.now() - 60_000);
        utimesSync(claim, old, old);

        const held = await withFileLock(lockFile, { staleMs: 1_000, waitMs: 50, pollMs: 5 }, async h => h);

        expect(held).toBe(false);
        expect(fs.readFileSync(lockFile, 'utf-8')).toBe(deadOwner);
        expect(fs.readFileSync(claim, 'utf-8')).toBe(`${process.pid}-paused`);
    });

    it('removes a claim whose claimant has exited, then breaks the lock', async () => {
        const exited = spawnSync(process.execPath, ['-e', '']).pid;
        const deadOwner = `${exited}-killed-mid-refresh`;
        fs.mkdirpSync(path.dirname(lockFile));
        writeFileSync(lockFile, deadOwner);
        writeFileSync(claimPath(lockFile, deadOwner), `${exited}-killed-mid-break`);

        const held = await withFileLock(lockFile, { staleMs: 60_000, waitMs: 50, pollMs: 5 }, async h => h);

        expect(held).toBe(true);
        expect(fs.readdirSync(path.dirname(lockFile))).toEqual([]);
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

describe('withFileLock across processes', () => {
    /**
     * Runs `processes` real Node processes against one lock file that a dead
     * process left behind, `rounds` times, and returns each round's log of
     * critical-section entries and exits. Every process breaks the same stale
     * lock at once, which is the race a read-then-unlink break loses.
     *
     * `leftBehind` names more files that the dead process left next to the lock,
     * given the lock's content. Each is seeded with the dead process as owner.
     * `slowUnlinkMs` makes every unlink in the children wait up to that many
     * milliseconds first, the way a process can be descheduled between reading
     * an owner and removing the file.
     */
    async function raceForStaleLock(
        rounds: number,
        processes: number,
        options: { leftBehind?: (lockContent: string) => string[]; slowUnlinkMs?: number } = {},
    ): Promise<string[][]> {
        const lockModule = path.join(directory, 'file-lock.js');
        const source = fs.readFileSync(path.join(__dirname, 'file-lock.ts'), 'utf-8');
        fs.writeFileSync(
            lockModule,
            ts.transpileModule(source, {
                compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
            }).outputText,
        );
        const child = path.join(directory, 'child.js');
        fs.writeFileSync(
            child,
            `const fs = require('node:fs');
const { appendFileSync } = fs;
const slowUnlinkMs = ${options.slowUnlinkMs ?? 0};
if (slowUnlinkMs > 0) {
    const unlinkSync = fs.unlinkSync;
    fs.unlinkSync = file => {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.random() * slowUnlinkMs);
        return unlinkSync(file);
    };
}
const { withFileLock } = require(${JSON.stringify(lockModule)});
const [lockFile, log] = process.argv.slice(2);
withFileLock(lockFile, { staleMs: 60000, waitMs: 20000, pollMs: 2 }, async held => {
    appendFileSync(log, 'enter ' + process.pid + ' ' + held + '\\n');
    await new Promise(resolve => setTimeout(resolve, 10));
    appendFileSync(log, 'exit ' + process.pid + '\\n');
});`,
        );
        const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
        const logs: string[][] = [];
        for (let round = 0; round < rounds; round++) {
            const log = path.join(directory, `round-${round}.log`);
            fs.mkdirpSync(path.dirname(lockFile));
            const deadOwner = `${deadPid}-left-behind`;
            writeFileSync(lockFile, deadOwner);
            for (const file of options.leftBehind?.(deadOwner) ?? []) {
                writeFileSync(file, deadOwner);
            }
            await Promise.all(
                Array.from(
                    { length: processes },
                    () =>
                        new Promise<void>((resolve, reject) => {
                            spawn(process.execPath, [child, lockFile, log], { stdio: 'inherit' })
                                .once('error', reject)
                                .once('exit', () => resolve());
                        }),
                ),
            );
            logs.push(fs.readFileSync(log, 'utf-8').trim().split('\n'));
        }
        return logs;
    }

    it('lets exactly one process hold the lock when several break the same stale lock', async () => {
        const logs = await raceForStaleLock(15, 6);

        for (const lines of logs) {
            expect(lines).toHaveLength(12);
            for (let i = 0; i < lines.length; i += 2) {
                const [, pid, held] = lines[i].split(' ');
                expect(lines[i]).toBe(`enter ${pid} true`);
                expect(held).toBe('true');
                expect(lines[i + 1]).toBe(`exit ${pid}`);
            }
        }
    }, 120_000);

    /**
     * A process that dies while it removes a stale lock leaves its claim behind
     * (in the earlier design, its `.break` breaker). With a read-then-unlink
     * break of that file, two waiters read the same dead owner, the first
     * removes the file and creates a new one, and the second removes the new
     * one. Both then remove the lock and both hold it. The breaker design
     * failed this test.
     */
    it("lets exactly one process hold the lock when several also recover a dead process's claim", async () => {
        const logs = await raceForStaleLock(15, 8, {
            leftBehind: deadOwner => [`${lockFile}.break`, claimPath(lockFile, deadOwner)],
            slowUnlinkMs: 20,
        });

        for (const lines of logs) {
            expect(lines).toHaveLength(16);
            for (let i = 0; i < lines.length; i += 2) {
                const [, pid] = lines[i].split(' ');
                expect(lines[i]).toBe(`enter ${pid} true`);
                expect(lines[i + 1]).toBe(`exit ${pid}`);
            }
        }
    }, 120_000);
});
