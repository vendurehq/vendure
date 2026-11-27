import { LogLine } from '@vendure/common/lib/log';
import { closeSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import path from 'node:path';

/** The directory of the dev log, relative to the project directory. */
export const DEV_LOG_DIRECTORY = '.vendure/logs';
/** The file the dev log is written to. Older lines are in the rotated files. */
export const DEV_LOG_FILE_NAME = 'dev.jsonl';
/** The size at which the dev log is rotated. */
export const DEV_LOG_MAX_BYTES = 10 * 1024 * 1024;
/** How many files the dev log keeps, the current one included. */
export const DEV_LOG_FILE_COUNT = 3;

/**
 * The files of the dev log, oldest first: `dev.2.jsonl`, `dev.1.jsonl`, then `dev.jsonl`.
 */
export function getDevLogFilePaths(projectDir: string): string[] {
    const directory = path.join(projectDir, DEV_LOG_DIRECTORY);
    const files = [path.join(directory, DEV_LOG_FILE_NAME)];
    for (let index = 1; index < DEV_LOG_FILE_COUNT; index++) {
        files.unshift(path.join(directory, `dev.${index}.jsonl`));
    }
    return files;
}

/**
 * Appends log lines to `.vendure/logs/dev.jsonl`, one JSON object per line. When the file reaches
 * {@link DEV_LOG_MAX_BYTES} it becomes `dev.1.jsonl`, the old `dev.1.jsonl` becomes `dev.2.jsonl`,
 * and the oldest file is deleted, so the log never holds more than {@link DEV_LOG_FILE_COUNT} files.
 *
 * Writes are synchronous, so lines from the server and the worker keep the order they arrived in,
 * and nothing is lost when the run exits.
 */
export class RotatingLogWriter {
    private readonly files: string[];
    private fd: number | undefined;
    private size = 0;

    constructor(
        projectDir: string,
        private readonly maxBytes = DEV_LOG_MAX_BYTES,
    ) {
        this.files = getDevLogFilePaths(projectDir);
    }

    write(line: LogLine): void {
        const data = Buffer.from(JSON.stringify(line) + '\n');
        this.open();
        if (this.size > 0 && this.size + data.length > this.maxBytes) {
            this.rotate();
        }
        writeSync(this.open(), data);
        this.size += data.length;
    }

    close(): void {
        if (this.fd !== undefined) {
            closeSync(this.fd);
            this.fd = undefined;
        }
    }

    private open(): number {
        if (this.fd === undefined) {
            const current = this.currentFile();
            mkdirSync(path.dirname(current), { recursive: true });
            this.fd = openSync(current, 'a', 0o600);
            this.size = fstatSync(this.fd).size;
        }
        return this.fd;
    }

    private rotate(): void {
        this.close();
        rmSync(this.files[0], { force: true });
        for (let index = 1; index < this.files.length; index++) {
            try {
                renameSync(this.files[index], this.files[index - 1]);
            } catch (e: unknown) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw e;
                }
            }
        }
        this.open();
    }

    private currentFile(): string {
        return this.files[this.files.length - 1];
    }
}
