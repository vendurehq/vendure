import { AssetImportStrategy, AssetService, RequestContext, UserInputError } from '@vendure/core';
import { pipeline, Readable, Transform } from 'stream';

const DEFAULT_MAX_ASSET_BYTES = 20 * 1024 * 1024;

function capStreamBytes(source: Readable, maxBytes: number): Readable {
    let total = 0;
    const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            total += Buffer.byteLength(chunk);
            if (total > maxBytes) {
                callback(new UserInputError(`Asset exceeds the maximum size of ${maxBytes} bytes`));
                return;
            }
            callback(null, chunk);
        },
    });
    pipeline(source, limiter, () => undefined);
    return limiter;
}

export async function uploadAssetFromUrl(
    ctx: RequestContext,
    url: string,
    assetService: AssetService,
    assetImportStrategy: AssetImportStrategy,
    options: { maxBytes?: number } = {},
) {
    if (!/^https?:\/\//.test(url)) {
        throw new UserInputError(
            `Unsupported asset URL scheme (only http and https URLs are allowed): ${url}`,
        );
    }
    const source = await assetImportStrategy.getStreamFromPath(url);
    const capped = capStreamBytes(source, options.maxBytes ?? DEFAULT_MAX_ASSET_BYTES);
    return assetService.createFromFileStream(capped, url, ctx);
}
