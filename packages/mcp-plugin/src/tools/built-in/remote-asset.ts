import {
    AssetImportStrategy,
    AssetService,
    isGraphQlErrorResult,
    RequestContext,
    UserInputError,
} from '@vendure/core';
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
    const created = await assetService.createFromFileStream(capped, url, ctx);
    if (isGraphQlErrorResult(created)) {
        // The store's `assetOptions.permittedFileTypes` refused this file. Throwing matches the
        // scheme and size rejections above, and it is the only way to tell the caller why: the
        // error result's own `message` is the fixed string "MIME_TYPE_ERROR", which Vendure
        // translates in its GraphQL layer, and an MCP tool call never passes through that layer.
        throw new UserInputError(
            `Unsupported asset file type for "${created.fileName}": ${created.mimeType}`,
        );
    }
    return created;
}
