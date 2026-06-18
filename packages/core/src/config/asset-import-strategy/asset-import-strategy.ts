import { Readable } from 'stream';

import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The AssetImportStrategy determines how asset files get imported based on the path given in the
 * import CSV or via the {@link AssetImporter} `getAssets()` method.
 *
 * The {@link DefaultAssetImportStrategy} is able to load files from either the local filesystem
 * or from a remote URL.
 *
 * A custom strategy could be created which could e.g. get the asset file from an S3 bucket.
 *
 * :::info
 *
 * This is configured via the `importExportOptions.assetImportStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @since 1.7.0
 * @docsCategory import-export
 */
export interface AssetImportStrategy extends InjectableStrategy {
    /**
     * @description
     * Given an asset path, this method should return a Stream of file data. This could
     * e.g. be read from a file system or fetch from a remote location.
     */
    getStreamFromPath(assetPath: string): Readable | Promise<Readable>;
}
