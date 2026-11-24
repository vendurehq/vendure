import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeSecretFile } from './secret-file.js';

describe('writeSecretFile', () => {
    let configDir: string;

    beforeEach(() => {
        configDir = mkdtempSync(path.join(tmpdir(), 'vendure-secret-file-'));
    });

    afterEach(() => {
        rmSync(configDir, { recursive: true, force: true });
    });

    it('writes a new file only the user can read, in the secrets directory', () => {
        const env = { VENDURE_CLI_CONFIG_DIR: configDir };

        const first = writeSecretFile(['cloud', 'key', 'delegate'], 'key', 'vcdk_one', env);
        const second = writeSecretFile(['cloud', 'key', 'delegate'], 'key', 'vcdk_two', env);

        expect(path.isAbsolute(first)).toBe(true);
        expect(path.dirname(first)).toBe(path.join(configDir, 'secrets'));
        expect(path.basename(first)).toMatch(/^cloud-key-delegate-key-/);
        expect(second).not.toBe(first);
        expect(readFileSync(first, 'utf-8')).toBe('vcdk_one');
        expect(readFileSync(second, 'utf-8')).toBe('vcdk_two');
        if (process.platform !== 'win32') {
            expect((statSync(first).mode % 0o1000).toString(8)).toBe('600');
            expect((statSync(path.dirname(first)).mode % 0o1000).toString(8)).toBe('700');
        }
    });
});
