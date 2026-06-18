import { AssetStorageStrategy } from '@vendure/core';
import { Request } from 'express';
import { Readable, Stream, Writable } from 'stream';

import { getTestImageBuffer } from './testing-asset-preview-strategy';

/**
 * A mock storage strategy which does not actually persist the assets anywhere.
 */
export class TestingAssetStorageStrategy implements AssetStorageStrategy {
    readFileToBuffer(identifier: string): Promise<Buffer> {
        return Promise.resolve(getTestImageBuffer());
    }

    readFileToStream(identifier: string): Promise<Stream> {
        const s = new Readable();
        s.push(identifier);
        s.push(null);
        return Promise.resolve(s);
    }

    toAbsoluteUrl(reqest: Request, identifier: string): string {
        const prefix = 'test-url/';
        return identifier.startsWith(prefix) ? identifier : `${prefix}${identifier}`;
    }

    writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        return Promise.resolve(`test-assets/${fileName}`);
    }

    writeFileFromStream(fileName: string, data: Stream): Promise<string> {
        const writable = new Writable();
        writable._write = (chunk, encoding, done) => {
            done();
        };
        return new Promise<string>((resolve, reject) => {
            data.pipe(writable);
            writable.on('finish', () => resolve(`test-assets/${fileName}`));
            writable.on('error', reject);
        });
    }

    fileExists(fileName: string): Promise<boolean> {
        return Promise.resolve(false);
    }

    deleteFile(identifier: string): Promise<void> {
        return Promise.resolve();
    }
}
