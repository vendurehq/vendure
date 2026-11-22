import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { getDevLogFilePaths, RotatingLogWriter } from './log-writer.js';

const directories: string[] = [];

afterEach(() => {
    for (const dir of directories.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function createProjectDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-log-'));
    directories.push(dir);
    return dir;
}

function readLines(filePath: string): string[] {
    try {
        return readFileSync(filePath, 'utf-8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line).msg);
    } catch {
        return [];
    }
}

const logLine = (msg: string) => ({
    ts: '2026-11-22T10:00:00.000Z',
    level: 'info' as const,
    msg,
    process: 'server',
});

describe('RotatingLogWriter', () => {
    it('appends one JSON object per line to .vendure/logs/dev.jsonl with mode 0600', () => {
        const projectDir = createProjectDir();
        const writer = new RotatingLogWriter(projectDir);
        writer.write(logLine('one'));
        writer.write(logLine('two'));
        writer.close();

        const current = path.join(projectDir, '.vendure', 'logs', 'dev.jsonl');
        expect(readLines(current)).toEqual(['one', 'two']);
        expect(statSync(current).mode % 0o1000).toBe(0o600);
    });

    it('rotates at the size limit and keeps three files, oldest first in getDevLogFilePaths()', () => {
        const projectDir = createProjectDir();
        const lineBytes = JSON.stringify(logLine('msg-0')).length + 1;
        // Two lines fit in a file, so each third line starts a new one.
        const writer = new RotatingLogWriter(projectDir, lineBytes * 2);
        for (let index = 0; index < 8; index++) {
            writer.write(logLine(`msg-${index}`));
        }
        writer.close();

        const [oldest, middle, current] = getDevLogFilePaths(projectDir);
        expect(path.basename(oldest)).toBe('dev.2.jsonl');
        expect(path.basename(middle)).toBe('dev.1.jsonl');
        expect(readLines(oldest)).toEqual(['msg-2', 'msg-3']);
        expect(readLines(middle)).toEqual(['msg-4', 'msg-5']);
        expect(readLines(current)).toEqual(['msg-6', 'msg-7']);
    });

    it('continues the size count of an existing file after a restart of the CLI', () => {
        const projectDir = createProjectDir();
        const lineBytes = JSON.stringify(logLine('msg-0')).length + 1;
        const first = new RotatingLogWriter(projectDir, lineBytes * 2);
        first.write(logLine('msg-0'));
        first.write(logLine('msg-1'));
        first.close();
        const second = new RotatingLogWriter(projectDir, lineBytes * 2);
        second.write(logLine('msg-2'));
        second.close();

        const [, middle, current] = getDevLogFilePaths(projectDir);
        expect(readLines(middle)).toEqual(['msg-0', 'msg-1']);
        expect(readLines(current)).toEqual(['msg-2']);
    });
});
