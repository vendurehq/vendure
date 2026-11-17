import { AssetType } from '@vendure/common/lib/generated-types';
import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../../../common/constants';
import { ConfigService } from '../../../config/config.service';
import { TransactionSubscriber } from '../../../connection/transaction-subscriber';

import { StoredMediaService } from './stored-media.service';

const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

describe('StoredMediaService', () => {
    const files = new Map<string, Buffer>();
    const fileExists = vi.fn(() => Promise.resolve(false));
    const writeFileFromBuffer = vi.fn((name: string, data: Buffer) => {
        files.set(name, data);
        return Promise.resolve(name);
    });
    const readFileToBuffer = vi.fn((name: string) => {
        const file = files.get(name);
        return file ? Promise.resolve(file) : Promise.reject(new Error(`Missing file: ${name}`));
    });
    const deleteFile = vi.fn((name: string) => {
        files.delete(name);
        return Promise.resolve();
    });
    const storage = {
        fileExists,
        writeFileFromBuffer,
        writeFileFromStream: vi.fn(async (name: string, stream: Readable) => {
            const chunks: Buffer[] = [];
            for await (const chunk of stream) chunks.push(Buffer.from(chunk));
            files.set(name, Buffer.concat(chunks));
            return name;
        }),
        readFileToBuffer,
        deleteFile,
    };
    const generatePreviewImage = vi.fn(() => Promise.resolve(png));
    const configService = {
        assetOptions: {
            permittedFileTypes: ['image/*'],
            assetStorageStrategy: storage,
            assetPreviewStrategy: { generatePreviewImage },
            assetNamingStrategy: {
                generateSourceFileName: vi.fn((_ctx, name: string) => `source/${name}`),
                generatePreviewFileName: vi.fn((_ctx, name: string) => `preview/${name}`),
            },
        },
    } as unknown as ConfigService;
    const awaitCommit = vi.fn();
    const awaitRollback = vi.fn();
    const transactionSubscriber = {
        awaitCommit,
        awaitRollback,
    } as unknown as TransactionSubscriber;
    let service: StoredMediaService;

    beforeEach(() => {
        files.clear();
        vi.clearAllMocks();
        service = new StoredMediaService(configService, transactionSubscriber);
    });

    it('validates, previews and stores an image', async () => {
        const result = await service.storeStream(
            RequestContext.empty(),
            Readable.from(png),
            'avatar.png',
            'image/png',
            { imageOnly: true },
        );

        expect(result).toMatchObject({
            type: AssetType.IMAGE,
            width: 1,
            height: 1,
            mimeType: 'image/png',
            source: 'source/avatar.png',
            preview: 'preview/source/avatar.png',
        });
        expect(files.size).toBe(2);
    });

    it('rejects content whose magic bytes reveal a non-image', async () => {
        const result = await service.storeStream(
            RequestContext.empty(),
            Readable.from(Buffer.from('%PDF-1.7\n')),
            'avatar.png',
            'image/png',
            { imageOnly: true },
        );

        expect(result.__typename).toBe('MimeTypeError');
        expect(files.size).toBe(0);
    });

    it('uses the detected content type as the canonical media type', async () => {
        const ctx = RequestContext.empty();
        const result = await service.storeStream(ctx, Readable.from(png), 'avatar.png', 'image/jpeg', {
            imageOnly: true,
        });

        expect(result).toMatchObject({ type: AssetType.IMAGE, mimeType: 'image/png' });
        expect(generatePreviewImage).toHaveBeenCalledWith(ctx, 'image/png', png);
    });

    it('cleans up the source when writing the preview fails', async () => {
        writeFileFromBuffer
            .mockImplementationOnce((name: string, data: Buffer) => {
                files.set(name, data);
                return Promise.resolve(name);
            })
            .mockRejectedValueOnce(new Error('preview failed'));

        await expect(
            service.storeStream(RequestContext.empty(), Readable.from(png), 'avatar.png', 'image/png'),
        ).rejects.toThrow('preview failed');
        expect(deleteFile).toHaveBeenCalledWith('source/avatar.png');
        expect(files.size).toBe(0);
    });

    it('attempts to delete both owned files when one deletion fails', async () => {
        deleteFile.mockRejectedValueOnce(new Error('source delete failed')).mockResolvedValueOnce(undefined);

        await expect(
            service.delete({ source: 'source.png', preview: 'preview.png' }),
        ).resolves.toBeUndefined();
        expect(deleteFile).toHaveBeenNthCalledWith(1, 'source.png');
        expect(deleteFile).toHaveBeenNthCalledWith(2, 'preview.png');
    });

    it('starts deleting both owned files before waiting for either deletion', async () => {
        let resolveSourceDelete: (() => void) | undefined;
        deleteFile.mockImplementationOnce(
            () =>
                new Promise<void>(resolve => {
                    resolveSourceDelete = resolve;
                }),
        );

        const deletion = service.delete({ source: 'source.png', preview: 'preview.png' });

        expect(deleteFile).toHaveBeenNthCalledWith(1, 'source.png');
        expect(deleteFile).toHaveBeenNthCalledWith(2, 'preview.png');
        if (!resolveSourceDelete) {
            throw new Error('Source deletion did not start');
        }
        resolveSourceDelete();
        await deletion;
    });

    it('cleans up newly stored media after transaction rollback', async () => {
        const queryRunner = { isTransactionActive: true };
        const ctx = RequestContext.empty();
        (ctx as any)[TRANSACTION_MANAGER_KEY] = { queryRunner };
        awaitRollback.mockResolvedValue(queryRunner as any);

        service.registerRollbackCleanup(ctx, { source: 'source.png', preview: 'preview.png' });

        await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledTimes(2));
    });

    it('defers deleting stored media until transaction commit', async () => {
        const queryRunner = { isTransactionActive: true };
        const ctx = RequestContext.empty();
        (ctx as any)[TRANSACTION_MANAGER_KEY] = { queryRunner };
        let resolveCommit: (queryRunner: any) => void;
        awaitCommit.mockReturnValue(
            new Promise(resolve => {
                resolveCommit = resolve;
            }),
        );

        await service.deleteOnCommit(ctx, { source: 'source.png', preview: 'preview.png' });
        expect(deleteFile).not.toHaveBeenCalled();

        if (!resolveCommit) {
            throw new Error('Commit callback was not registered');
        }
        resolveCommit(queryRunner);
        await vi.waitFor(() => expect(deleteFile).toHaveBeenCalledTimes(2));
    });
});
