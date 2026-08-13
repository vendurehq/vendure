import { describe, expect, it } from 'vitest';

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
});
