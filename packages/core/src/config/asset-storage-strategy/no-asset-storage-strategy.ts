import { Request } from 'express';
import { Stream } from 'stream';

import { InternalServerError } from '../../common/error/errors';

import { AssetStorageStrategy } from './asset-storage-strategy';

const errorMessage = 'error.no-asset-storage-strategy-configured';

/**
 * A placeholder strategy which will simply throw an error when used.
 */
export class NoAssetStorageStrategy implements AssetStorageStrategy {
    writeFileFromStream(fileName: string, data: Stream): Promise<string> {
        throw new InternalServerError(errorMessage);
    }

    writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        throw new InternalServerError(errorMessage);
    }

    readFileToBuffer(identifier: string): Promise<Buffer> {
        throw new InternalServerError(errorMessage);
    }

    readFileToStream(identifier: string): Promise<Stream> {
        throw new InternalServerError(errorMessage);
    }

    deleteFile(identifier: string): Promise<void> {
        throw new InternalServerError(errorMessage);
    }

    toAbsoluteUrl(request: Request, identifier: string): string {
        throw new InternalServerError(errorMessage);
    }

    fileExists(fileName: string): Promise<boolean> {
        throw new InternalServerError(errorMessage);
    }
}
