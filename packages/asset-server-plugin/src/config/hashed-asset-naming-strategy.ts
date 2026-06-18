import { DefaultAssetNamingStrategy, RequestContext } from '@vendure/core';
import { createHash } from 'crypto';
import path from 'path';

/**
 * @description
 * An extension of the {@link DefaultAssetNamingStrategy} which prefixes file names with
 * the type (`'source'` or `'preview'`) as well as a 2-character sub-directory based on
 * the md5 hash of the original file name.
 *
 * This is an implementation of the technique knows as "hashed directory" file storage,
 * and the purpose is to reduce the number of files in a single directory, since a very large
 * number of files can lead to performance issues when reading and writing to that directory.
 *
 * With this strategy, even with 200,000 total assets stored, each directory would
 * only contain less than 800 files.
 *
 * @docsCategory core plugins/AssetServerPlugin
 */
export class HashedAssetNamingStrategy extends DefaultAssetNamingStrategy {
    generateSourceFileName(ctx: RequestContext, originalFileName: string, conflictFileName?: string): string {
        const filename = super.generateSourceFileName(ctx, originalFileName, conflictFileName);
        return path.join('source', this.getHashedDir(filename), filename);
    }
    generatePreviewFileName(
        ctx: RequestContext,
        originalFileName: string,
        conflictFileName?: string,
    ): string {
        const filename = super.generatePreviewFileName(ctx, originalFileName, conflictFileName);
        return path.join('preview', this.getHashedDir(filename), filename);
    }

    private getHashedDir(filename: string): string {
        return createHash('md5').update(filename).digest('hex').slice(0, 2);
    }
}
