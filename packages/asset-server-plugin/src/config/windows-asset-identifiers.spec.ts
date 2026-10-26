import { RequestContext } from '@vendure/core';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetServer } from '../asset-server';

import { HashedAssetNamingStrategy } from './hashed-asset-naming-strategy';
import { LocalAssetStorageStrategy } from './local-asset-storage-strategy';
import { S3AssetStorageStrategy } from './s3-asset-storage-strategy';

// Simulate running on Windows by replacing the platform `path` module with `path.win32`.
vi.mock('path', async () => {
    const actual = await vi.importActual<typeof import('path')>('path');
    return { ...actual.win32, default: actual.win32 };
});
vi.mock('node:path', async () => {
    const actual = await vi.importActual<typeof import('path')>('path');
    return { ...actual.win32, default: actual.win32 };
});
vi.mock('fs-extra', () => {
    const fsMock = {
        ensureDirSync: vi.fn(),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(Buffer.from('')),
    };
    return { ...fsMock, default: fsMock };
});

// #3197 - asset identifiers and S3 keys must use forward slashes on Windows
describe('asset identifiers on Windows', () => {
    const ctx = RequestContext.empty();

    it('HashedAssetNamingStrategy uses forward slashes', () => {
        const strategy = new HashedAssetNamingStrategy();

        const source = strategy.generateSourceFileName(ctx, 'image.jpg');
        const preview = strategy.generatePreviewFileName(ctx, 'image.jpg');

        expect(source).toMatch(/^source\/[0-9a-f]{2}\/image\.jpg$/);
        expect(preview).toMatch(/^preview\/[0-9a-f]{2}\/image__preview\.jpg$/);
    });

    describe('LocalAssetStorageStrategy', () => {
        let fs: any;

        beforeEach(async () => {
            fs = (await import('fs-extra')).default;
            vi.clearAllMocks();
        });

        it('returns an identifier with forward slashes', async () => {
            const strategy = new LocalAssetStorageStrategy('C:\\vendure\\assets');

            const identifier = await strategy.writeFileFromBuffer('source/ab/image.jpg', Buffer.from(''));

            expect(fs.writeFile).toHaveBeenCalledWith(
                'C:\\vendure\\assets\\source\\ab\\image.jpg',
                expect.anything(),
                'binary',
            );
            expect(identifier).toBe('source/ab/image.jpg');
        });

        it('does not leak a forward-slash uploadPath into the identifier', async () => {
            const strategy = new LocalAssetStorageStrategy('C:/vendure/assets');

            const identifier = await strategy.writeFileFromBuffer('source/ab/image.jpg', Buffer.from(''));

            expect(identifier).toBe('source/ab/image.jpg');
        });

        it('still reads identifiers stored with backslashes', async () => {
            const strategy = new LocalAssetStorageStrategy('C:\\vendure\\assets');

            await strategy.readFileToBuffer('source\\ab\\image.jpg');

            expect(fs.readFile).toHaveBeenCalledWith('C:\\vendure\\assets\\source\\ab\\image.jpg');
        });
    });

    it('S3AssetStorageStrategy uses forward slashes in object keys', async () => {
        const strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        const send = vi.fn().mockResolvedValue({});
        (strategy as any).s3Client = { send };
        (strategy as any).AWS = {
            DeleteObjectCommand: class {
                constructor(public input: any) {}
            },
        };

        await strategy.deleteFile('source/ab/image.jpg');

        expect(send.mock.calls.map((call: any[]) => call[0].input.Key)).toEqual([
            'source/ab/image.jpg',
            'source\\ab\\image.jpg',
        ]);
    });

    it('falls back to a legacy backslash key when a browser-normalized URL misses', async () => {
        const strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        const keys: string[] = [];
        const send = vi.fn().mockImplementation(async (command: any) => {
            keys.push(command.input.Key);
            if (keys.length === 1) {
                const error: any = new Error('missing POSIX key');
                error.name = 'NoSuchKey';
                error.$metadata = { httpStatusCode: 404 };
                throw error;
            }
            return { Body: Readable.from([Buffer.from('legacy asset')]) };
        });
        (strategy as any).s3Client = { send };
        (strategy as any).AWS = {
            GetObjectCommand: class {
                constructor(public input: any) {}
            },
        };

        const result = await strategy.readFileToBuffer('source/ab/image.jpg');

        expect(result.toString()).toBe('legacy asset');
        expect(keys).toEqual(['source/ab/image.jpg', 'source\\ab\\image.jpg']);
    });

    it('reserves a forward-slash name when only the legacy S3 key exists', async () => {
        const strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        const keys: string[] = [];
        const send = vi.fn().mockImplementation(async (command: any) => {
            keys.push(command.input.Key);
            if (keys.length === 1) {
                const error: any = new Error('missing POSIX key');
                error.name = 'NotFound';
                error.$metadata = { httpStatusCode: 404 };
                throw error;
            }
            return {};
        });
        (strategy as any).s3Client = { send };
        (strategy as any).AWS = {
            HeadObjectCommand: class {
                constructor(public input: any) {}
            },
        };

        const exists = await strategy.fileExists('source/ab/image.jpg');

        expect(exists).toBe(true);
        expect(keys).toEqual(['source/ab/image.jpg', 'source\\ab\\image.jpg']);
    });

    it('returns false for a missing flat filename', async () => {
        const strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        const send = vi.fn().mockRejectedValue(
            Object.assign(new Error('missing flat key'), {
                name: 'NotFound',
                $metadata: { httpStatusCode: 404 },
            }),
        );
        (strategy as any).s3Client = { send };
        (strategy as any).AWS = {
            HeadObjectCommand: class {
                constructor(public input: any) {}
            },
        };

        const exists = await strategy.fileExists('image.jpg');

        expect(exists).toBe(false);
        expect(send).toHaveBeenCalledOnce();
    });

    it('AssetServer uses forward slashes in S3 cache keys', () => {
        const s3Strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        const server = new AssetServer(
            {} as any,
            { assetOptions: { assetStorageStrategy: s3Strategy } } as any,
            {} as any,
        );

        const cacheKey: string = (server as any).getFileNameFromParameters('source/ab/image.jpg', {
            width: 100,
            mode: 'crop',
        });

        expect(cacheKey).toMatch(/^cache\/source\/ab\/image[0-9a-f]{32}\.jpg$/);
    });

    it('AssetServer uses forward slashes in cache keys for a non-S3 strategy', () => {
        const server = new AssetServer(
            {} as any,
            {
                assetOptions: {
                    assetStorageStrategy: new LocalAssetStorageStrategy('C:\\vendure\\assets'),
                },
            } as any,
            {} as any,
        );

        const cacheKey: string = (server as any).getFileNameFromParameters('/source/ab/image.jpg', {
            width: 100,
            mode: 'crop',
        });

        expect(cacheKey).not.toContain('\\');
        expect(cacheKey).toMatch(/^cache\/source\/ab\/image[0-9a-f]{32}\.jpg$/);
    });

    it('AssetServer still strips traversal segments for a non-S3 strategy', () => {
        const server = new AssetServer(
            {} as any,
            {
                assetOptions: {
                    assetStorageStrategy: new LocalAssetStorageStrategy('C:\\vendure\\assets'),
                },
            } as any,
            {} as any,
        );

        const identifier: string = (server as any).getFileNameFromParameters(
            '/source/..\\..\\windows/system32/config',
            {},
        );

        expect(identifier).not.toContain('..');
    });
});
