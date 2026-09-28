import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { S3AssetStorageStrategy } from './s3-asset-storage-strategy';

describe('S3AssetStorageStrategy', () => {
    function createStrategyWithUploadSpy() {
        const uploadParams: any[] = [];
        const strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        (strategy as any).libStorage = {
            Upload: class {
                constructor(config: { params: any }) {
                    uploadParams.push(config.params);
                }
                done() {
                    return Promise.resolve({ Key: uploadParams[uploadParams.length - 1].Key });
                }
            },
        };
        return { strategy, uploadParams };
    }

    /**
     * Stands in for a bucket holding the given keys. S3 keys are opaque strings, so a key
     * containing backslashes is a different object from the same key containing forward
     * slashes, and DeleteObject reports success whether or not the key was there.
     */
    function createStrategyWithBucket(keys: Record<string, string>) {
        const bucket = new Map(Object.entries(keys));
        const notFound = (name: string) =>
            Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
        class GetObjectCommand {
            constructor(public input: any) {}
        }
        class HeadObjectCommand {
            constructor(public input: any) {}
        }
        class DeleteObjectCommand {
            constructor(public input: any) {}
        }
        const strategy = new S3AssetStorageStrategy({ bucket: 'test', credentials: null as any }, () => '');
        (strategy as any).AWS = { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand };
        (strategy as any).s3Client = {
            send: vi.fn((command: any) => {
                const key = command.input.Key;
                if (command instanceof GetObjectCommand) {
                    const contents = bucket.get(key);
                    return contents === undefined
                        ? Promise.reject(notFound('NoSuchKey'))
                        : Promise.resolve({ Body: Readable.from([Buffer.from(contents)]) });
                }
                if (command instanceof HeadObjectCommand) {
                    return bucket.has(key) ? Promise.resolve({}) : Promise.reject(notFound('NotFound'));
                }
                if (command instanceof DeleteObjectCommand) {
                    bucket.delete(key);
                    return Promise.resolve({});
                }
                return Promise.reject(new Error(`Unexpected command ${command.constructor.name}`));
            }),
        };
        return { strategy, bucket };
    }

    it('sets ContentType from the file extension', async () => {
        const { strategy, uploadParams } = createStrategyWithUploadSpy();

        await strategy.writeFileFromBuffer('some-file.pdf', Buffer.from(''));

        expect(uploadParams[0].ContentType).toBe('application/pdf');
    });

    it('falls back to application/octet-stream for unknown extensions', async () => {
        const { strategy, uploadParams } = createStrategyWithUploadSpy();

        await strategy.writeFileFromStream('some-file.unknown-ext', Buffer.from('') as any);

        expect(uploadParams[0].ContentType).toBe('application/octet-stream');
    });

    // #3197 - `readFile` and `fileExists` resolve a forward-slash identifier to the legacy
    // backslash key, so `deleteFile` has to remove that key too or the asset survives a
    // delete that reported success.
    it('deletes the legacy backslash key as well as the normalized one', async () => {
        const { strategy, bucket } = createStrategyWithBucket({ 'source\\ab\\image.jpg': 'legacy asset' });

        await strategy.deleteFile('source/ab/image.jpg');

        expect([...bucket.keys()]).toEqual([]);
        expect(await strategy.fileExists('source/ab/image.jpg')).toBe(false);
        await expect(strategy.readFileToBuffer('source/ab/image.jpg')).rejects.toThrow('NoSuchKey');
    });

    it('deletes both key forms when the asset exists under each', async () => {
        const { strategy, bucket } = createStrategyWithBucket({
            'source/ab/image.jpg': 'current asset',
            'source\\ab\\image.jpg': 'legacy asset',
        });

        await strategy.deleteFile('source/ab/image.jpg');

        expect([...bucket.keys()]).toEqual([]);
    });

    it('issues a single delete for an identifier with no separator', async () => {
        const { strategy } = createStrategyWithBucket({ 'image.jpg': 'asset' });

        await strategy.deleteFile('image.jpg');

        expect((strategy as any).s3Client.send).toHaveBeenCalledOnce();
    });

    // #3197 - a bucket policy without `s3:ListBucket` makes S3 answer 403 instead of 404 for
    // a key that is not there, and `generateUniqueName` in the core AssetService calls
    // `fileExists` on every upload, so throwing here fails uploads that used to succeed.
    it('treats a non-404 error as not found rather than throwing', async () => {
        const { strategy } = createStrategyWithBucket({});
        (strategy as any).s3Client.send = vi.fn().mockRejectedValue(
            Object.assign(new Error('AccessDenied'), {
                name: 'AccessDenied',
                $metadata: { httpStatusCode: 403 },
            }),
        );

        await expect(strategy.fileExists('source/ab/image.jpg')).resolves.toBe(false);
    });

    it('propagates a delete failure rather than reporting success', async () => {
        const { strategy } = createStrategyWithBucket({});
        (strategy as any).s3Client.send = vi.fn().mockRejectedValue(
            Object.assign(new Error('AccessDenied'), {
                name: 'AccessDenied',
                $metadata: { httpStatusCode: 403 },
            }),
        );

        await expect(strategy.deleteFile('source/ab/image.jpg')).rejects.toThrow('AccessDenied');
    });
});
