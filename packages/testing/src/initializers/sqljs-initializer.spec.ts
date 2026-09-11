import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SqljsInitializer } from './sqljs-initializer';

describe('SqljsInitializer', () => {
    let temporaryDir: string;

    beforeEach(() => {
        temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-sqljs-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(temporaryDir, { recursive: true, force: true });
    });

    it('populates when another worker creates the directory just before mkdir', async () => {
        const dataDir = path.join(temporaryDir, 'data');
        const initializer = new SqljsInitializer(dataDir);
        const options = await initializer.init('first.spec.ts', { type: 'sqljs' });
        const mkdir = fs.mkdirSync;
        vi.spyOn(fs, 'mkdirSync').mockImplementationOnce((directory, mkdirOptions) => {
            // #5322: another worker wins the race after the missing-directory check.
            mkdir(directory, { recursive: true });
            return mkdir(directory, mkdirOptions);
        });
        const populate = vi.fn(async () => {
            expect(fs.statSync(dataDir).isDirectory()).toBe(true);
            expect(options.autoSave).toBe(true);
            expect(options.synchronize).toBe(true);
        });

        await initializer.populate(populate);

        expect(populate).toHaveBeenCalledOnce();
        expect(options.autoSave).toBe(false);
        expect(options.synchronize).toBe(false);
    });

    it('creates missing parent directories', async () => {
        const dataDir = path.join(temporaryDir, 'nested', 'data');
        const initializer = new SqljsInitializer(dataDir);
        await initializer.init('nested.spec.ts', { type: 'sqljs' });
        const populate = vi.fn(async () => {
            expect(fs.statSync(dataDir).isDirectory()).toBe(true);
        });

        await initializer.populate(populate);

        expect(populate).toHaveBeenCalledOnce();
    });

    it('populates a new database in an existing directory', async () => {
        const initializer = new SqljsInitializer(temporaryDir);
        await initializer.init('existing.spec.ts', { type: 'sqljs' });
        const populate = vi.fn(async () => undefined);

        await initializer.populate(populate);

        expect(populate).toHaveBeenCalledOnce();
    });

    it('does not populate an already cached database', async () => {
        const initializer = new SqljsInitializer(temporaryDir);
        await initializer.init('cached.spec.ts', { type: 'sqljs' });
        fs.writeFileSync(path.join(temporaryDir, 'cached.spec.ts.sqlite'), 'cached');
        const populate = vi.fn(async () => undefined);

        await initializer.populate(populate);

        expect(populate).not.toHaveBeenCalled();
    });
});
