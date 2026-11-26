import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Injector } from '../../common/injector';

import { DefaultAssetImportStrategy } from './default-asset-import-strategy';

describe('DefaultAssetImportStrategy local files', () => {
    let tmpDir: string;
    let importAssetsDir: string;
    let outsideFile: string;
    let strategy: DefaultAssetImportStrategy;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-asset-import-'));
        importAssetsDir = path.join(tmpDir, 'assets');
        fs.mkdirSync(path.join(importAssetsDir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(importAssetsDir, 'inside.txt'), 'inside');
        fs.writeFileSync(path.join(importAssetsDir, 'sub', 'nested.txt'), 'nested');
        // A file that exists, but lives next to (not inside) the import assets dir.
        outsideFile = path.join(tmpDir, 'outside.txt');
        fs.writeFileSync(outsideFile, 'outside');

        strategy = new DefaultAssetImportStrategy();
        strategy.init({
            get: () => ({ importExportOptions: { importAssetsDir } }),
        } as unknown as Injector);
    });

    afterAll(() => {
        fs.removeSync(tmpDir);
    });

    async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks).toString();
    }

    it('reads a file inside the import assets dir', async () => {
        const stream = await strategy.getStreamFromPath('inside.txt');
        expect(await readAll(stream)).toBe('inside');
    });

    it('reads a file in a subdirectory, and a path whose ".." stays inside the dir', async () => {
        expect(await readAll(await strategy.getStreamFromPath('sub/nested.txt'))).toBe('nested');
        expect(await readAll(await strategy.getStreamFromPath('sub/../inside.txt'))).toBe('inside');
    });

    it('rejects a relative path that escapes the import assets dir', () => {
        expect(() => strategy.getStreamFromPath('../outside.txt')).toThrow(
            /outside the import assets directory/,
        );
        expect(() => strategy.getStreamFromPath('sub/../../outside.txt')).toThrow(
            /outside the import assets directory/,
        );
    });

    it('re-roots an absolute path under the import assets dir, as before', async () => {
        expect(await readAll(await strategy.getStreamFromPath('/inside.txt'))).toBe('inside');
        expect(() => strategy.getStreamFromPath(outsideFile)).toThrow(/does not exist/);
    });

    it('still reports a missing file inside the dir as not existing', () => {
        expect(() => strategy.getStreamFromPath('missing.txt')).toThrow(/does not exist/);
    });
});
