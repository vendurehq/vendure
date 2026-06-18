import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { isGraphQlErrorResult } from '../../../common/index';
import { ConfigService } from '../../../config/config.service';
import { Asset } from '../../../entity/asset/asset.entity';
import { AssetService } from '../../../service/services/asset.service';

/**
 * @description
 * This service creates new {@link Asset} entities based on string paths provided in the CSV
 * import format. The source files are resolved by joining the value of `importExportOptions.importAssetsDir`
 * with the asset path. This service is used internally by the {@link Importer} service.
 *
 * @docsCategory import-export
 */
@Injectable()
export class AssetImporter {
    private assetMap = new Map<string, Asset>();

    /** @internal */
    constructor(private configService: ConfigService, private assetService: AssetService) {}

    /**
     * @description
     * Creates Asset entities for the given paths, using the assetMap cache to prevent the
     * creation of duplicates.
     */
    async getAssets(
        assetPaths: string[],
        ctx?: RequestContext,
    ): Promise<{ assets: Asset[]; errors: string[] }> {
        const assets: Asset[] = [];
        const errors: string[] = [];
        const { assetImportStrategy } = this.configService.importExportOptions;
        const uniqueAssetPaths = new Set(assetPaths);
        for (const assetPath of uniqueAssetPaths.values()) {
            const cachedAsset = this.assetMap.get(assetPath);
            if (cachedAsset) {
                assets.push(cachedAsset);
            } else {
                try {
                    const stream = await assetImportStrategy.getStreamFromPath(assetPath);
                    if (stream) {
                        const asset = await this.assetService.createFromFileStream(stream, assetPath, ctx);
                        if (isGraphQlErrorResult(asset)) {
                            errors.push(asset.message);
                        } else {
                            this.assetMap.set(assetPath, asset as Asset);
                            assets.push(asset as Asset);
                        }
                    }
                } catch (e: any) {
                    errors.push(e.message);
                }
            }
        }
        return { assets, errors };
    }
}
